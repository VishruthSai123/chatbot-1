import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { z } from "zod";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  getModelAvailability,
} from "@/lib/ai/models";
import {
  errorClass,
  errorStatusCode,
  logChatObservation,
  providerForModel,
} from "@/lib/ai/observability";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { withVisibleOutputGuard } from "@/lib/ai/stream-guard";
import {
  mergeClientToolResults,
  resolveDanglingToolCalls,
} from "@/lib/ai/tool-continuity";
import {
  audioInfo,
  audioOpen,
  audioTranscribe,
} from "@/lib/ai/tools/audio-tools";
import { createDocument } from "@/lib/ai/tools/create-document";
import { deviceAction } from "@/lib/ai/tools/device-action";
import {
  docConvert,
  docDiff,
  docRead,
  docStats,
  docSummarize,
} from "@/lib/ai/tools/doc-tools";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import {
  imageCollage,
  imageCompress,
  imageConvert,
  imageCrop,
  imageListPresets,
  imageOcr,
  imageOverlay,
  imagePixelate,
  imageRemoveBg,
  imageResize,
  imageRotate,
  imageStitch,
  imageUpscaleEnhance,
} from "@/lib/ai/tools/image-tools";
import { downloadMedia } from "@/lib/ai/tools/media-tools";
import {
  notebookAddSource,
  notebookAsk,
  notebookCreate,
  notebookGenerate,
  notebookGrade,
  notebookQuiz,
} from "@/lib/ai/tools/notebook-tools";
import {
  imageToPdf,
  pdfArrange,
  pdfExtractText,
  pdfGetInfo,
  pdfMerge,
  pdfRotatePages,
  pdfSplit,
} from "@/lib/ai/tools/pdf-tools";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { research } from "@/lib/ai/tools/research";
import {
  sheetConvertFormat,
  sheetFilterSort,
  sheetGetInfo,
  sheetRemoveDuplicates,
  sheetSummaryStats,
} from "@/lib/ai/tools/sheet-tools";
import { slidesCreate, slidesEdit } from "@/lib/ai/tools/slides-tools";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { readUrl, webSearch } from "@/lib/ai/tools/web-search";
import { makeAttachmentsReadable } from "@/lib/attachments/readable";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import {
  describeRequirement,
  parseImageRequirement,
} from "@/lib/image/requirements";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

/**
 * How long a chat turn may run.
 *
 * A deep research turn searches, reads several pages and writes a report, which
 * does not fit in a minute. The platform's own ceiling is what actually applies
 * — 300 seconds on the Hobby plan with Fluid compute — so this asks for the
 * room rather than imposing the old minute.
 */
export const maxDuration = 300;

const HEALTH_CHECK_DELAY_MS = 9000;

function isModelStreamActivity(chunk: { type: string }) {
  return !["start", "start-step", "finish-step", "finish", "raw"].includes(
    chunk.type
  );
}

function isVisibleModelChunk(chunk: { delta?: string; type: string }) {
  if (chunk.type === "text-delta") {
    return Boolean(chunk.delta?.trim());
  }
  return chunk.type === "tool-call" || chunk.type === "tool-input-start";
}

/** The text the user typed, ignoring attachments. */
function textFromUserMessage(message?: PostRequestBody["message"]): string {
  return (message?.parts ?? [])
    .filter(
      (part): part is { text: string; type: "text" } => part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/**
 * True when the user asked for a quiz in this turn.
 *
 * The check is intentionally broad: the route only acts on it after a notebook
 * was created, and a user who mentions a quiz while building a notebook almost
 * always wants one. Missing the intent leaves the request half-done; the cost
 * of the occasional extra quiz is much lower.
 */
function askedForQuiz(text: string): boolean {
  return /\bquiz\b/i.test(text) || /\btest me\b/i.test(text);
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;
  const requestId =
    request.headers.get("x-request-id")?.slice(0, 100) || generateUUID();
  const startedAt = Date.now();

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    // The validation detail is logged but not returned: the client gets a
    // generic message, and the server keeps the reason. Swallowing it entirely
    // makes a rejected request indistinguishable from any other bad request.
    if (error instanceof z.ZodError) {
      console.error(
        "Chat request failed validation:",
        JSON.stringify(error.issues, null, 2)
      );
    }

    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const {
      activeImage,
      activePdf,
      activeSheet,
      androidBridge,
      id,
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
    } = requestBody;

    const [botIdResult, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (botIdResult?.isBot) {
      return new ChatbotError("forbidden:api").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    const userType: UserType = session.user.type;

    // These four calls are independent. Batch them into a single concurrent
    // round-trip instead of four sequential awaits — the serialized database
    // round-trips were the dominant cause of "time to first token".
    const [, messageCount, chat, modelCapabilities] = await Promise.all([
      checkIpRateLimit(ipAddress(request)),
      getMessageCountByUserId({
        differenceInHours: 1,
        id: session.user.id,
      }),
      getChatById({ id }),
      getCapabilities(),
    ]);

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    const persistUserMessage = async () => {
      if (message?.role !== "user") {
        return;
      }

      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });
    };

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }

      // Read history and persist this message concurrently (one round-trip).
      // Filter out our own row in case the insert lands before the read.
      const [history] = await Promise.all([
        getMessagesByChatId({ id }),
        persistUserMessage(),
      ]);

      const isValidDbMessage = (row: DBMessage) => {
        if (!Array.isArray(row.parts) || row.parts.length === 0) {
          return false;
        }
        if (row.role === "assistant") {
          return (row.parts as Array<{ type?: string }>).some(
            (p) =>
              p.type === "text" ||
              p.type?.startsWith("tool-") ||
              p.type === "reasoning" ||
              (p as { type?: string }).type === "error"
          );
        }
        return true;
      };

      messagesFromDb = history.filter(
        (row) => row.id !== message?.id && isValidDbMessage(row)
      );
    } else if (message?.role === "user") {
      await saveChat({
        id,
        title: "New chat",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      await persistUserMessage();
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);

      /*
       * The database has the assistant tool call, but a client-side tool such
       * as deviceAction writes its result only in the WebView. Merge every
       * resolved client tool part back before the model sees the history.
       */
      uiMessages = mergeClientToolResults({
        clientMessages: messages as ChatMessage[],
        dbMessages,
      });
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    /*
     * Never call a model with half a tool exchange. A stopped generation, a
     * dropped native callback or a client race can leave a call without a
     * result; resolve it as an explicit error instead of letting the SDK throw
     * AI_MissingToolResultsError.
     */
    const continuity = resolveDanglingToolCalls(uiMessages);
    uiMessages = continuity.messages;

    if (continuity.resolvedToolCallIds.length > 0) {
      logChatObservation("chat_tool_continuity_repaired", {
        modelId: chatModel,
        requestId,
        toolCallCount: continuity.resolvedToolCallIds.length,
      });
    }

    // Deterministic parse of the user's latest message: geometry hint for the
    // prompt + argument repair for the image tools (no model involved).
    const lastUserMessage = [...uiMessages]
      .reverse()
      .find((msg) => msg.role === "user");
    const lastUserText =
      lastUserMessage?.parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ") ?? "";
    const parsedRequirement = parseImageRequirement(lastUserText);
    const imageRequirementHint = describeRequirement(parsedRequirement);
    const requirement = parsedRequirement.spec;

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      city,
      country,
      latitude,
      longitude,
    };

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;
    const provider = modelConfig?.provider ?? providerForModel(chatModel);
    const isGeminiModel = provider === "google";

    logChatObservation("chat_request", {
      modelId: chatModel,
      provider,
      requestId,
      userType,
    });

    /**
     * Attachments are converted before the provider sees them.
     *
     * A PDF, DOCX, spreadsheet or deck is a container, not text; sending it
     * as a file part only works on providers that happen to accept that type.
     * This turns every attachment into text (or an image the model can see),
     * so "summarise this" works for every file the upload accepts.
     */
    const readableMessages = await makeAttachmentsReadable({
      messages: uiMessages,
      userId: session.user.id,
      vision: capabilities?.vision === true,
    });

    const converted = await convertToModelMessages(readableMessages);

    // Merge consecutive messages with the same role (e.g. consecutive user messages)
    // so LLM providers that require strictly alternating roles do not reject the request
    const rawModelMessages: typeof converted = [];
    for (const msg of converted) {
      if (
        !msg.content ||
        (Array.isArray(msg.content) && msg.content.length === 0) ||
        (typeof msg.content === "string" && !msg.content.trim())
      ) {
        continue;
      }
      const prev = rawModelMessages.at(-1);
      if (prev && prev.role === msg.role) {
        if (msg.role === "user" && prev.role === "user") {
          const prevParts = Array.isArray(prev.content)
            ? prev.content
            : [{ text: String(prev.content), type: "text" as const }];
          const currentParts = Array.isArray(msg.content)
            ? msg.content
            : [{ text: String(msg.content), type: "text" as const }];
          rawModelMessages[rawModelMessages.length - 1] = {
            ...prev,
            content: [...prevParts, ...currentParts],
          } as (typeof rawModelMessages)[number];
        } else {
          rawModelMessages[rawModelMessages.length - 1] = msg;
        }
      } else {
        rawModelMessages.push(msg);
      }
    }

    // If the selected model cannot see images, turn file parts into a short
    // note instead of sending an unsupported part to the provider.
    const modelMessages = capabilities?.vision
      ? rawModelMessages
      : (rawModelMessages.map((msg) => {
          if (msg.role === "user" && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map((part) => {
                if (part.type === "file") {
                  const filename =
                    (part as { filename?: string }).filename || "file";
                  const mediaType =
                    (part as { mediaType?: string }).mediaType || "attachment";
                  return {
                    text: `[Attached file: ${filename} (${mediaType})]`,
                    type: "text" as const,
                  };
                }
                return part;
              }),
            };
          }
          return msg;
        }) as typeof rawModelMessages);

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let streamError: Error | unknown = null;
        let hasModelActivity = false;
        let hasVisibleOutput = false;
        let healthCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const clearHealthCheckTimer = () => {
          if (healthCheckTimer) {
            clearTimeout(healthCheckTimer);
          }
        };

        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          messageText: string
        ) => {
          if (hasModelActivity && phase !== "thinking") {
            return;
          }
          dataStream.write({
            data: {
              message: messageText,
              modelId: chatModel,
              modelName,
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "Waiting...");

        healthCheckTimer = setTimeout(() => {
          getModelAvailability(chatModel)
            .then((availability) => {
              if (availability === "impacted") {
                writeWaitingStatus(
                  "health",
                  `${modelName} may be slow or unavailable right now...`
                );
              } else {
                writeWaitingStatus("still-waiting", "Still waiting...");
              }
            })
            .catch(() => {
              writeWaitingStatus("still-waiting", "Still waiting...");
            });
        }, HEALTH_CHECK_DELAY_MS);

        const markModelActive = () => {
          if (hasModelActivity) {
            return;
          }
          hasModelActivity = true;
          clearHealthCheckTimer();
          writeWaitingStatus("thinking", "Thinking...");
        };

        const stopWaitingStatus = () => {
          hasModelActivity = true;
          clearHealthCheckTimer();
        };

        const quizRequested = askedForQuiz(textFromUserMessage(message));

        const result = streamText({
          abortSignal: request.signal,
          activeTools: supportsTools
            ? [
                "getWeather",
                "createDocument",
                "editDocument",
                "updateDocument",
                "requestSuggestions",
                "imageResize",
                "imageRemoveBg",
                "imageCrop",
                "imageCompress",
                "imageConvert",
                "imageUpscaleEnhance",
                "imagePixelate",
                "imageRotate",
                "imageOcr",
                "imageListPresets",
                "imageStitch",
                "imageOverlay",
                "imageCollage",
                "pdfGetInfo",
                "pdfMerge",
                "pdfSplit",
                "pdfArrange",
                "pdfRotatePages",
                "pdfExtractText",
                "imageToPdf",
                "sheetGetInfo",
                "sheetFilterSort",
                "sheetRemoveDuplicates",
                "sheetSummaryStats",
                "sheetConvertFormat",
                "webSearch",
                "readUrl",
                "research",
                "notebookCreate",
                "notebookAsk",
                "notebookGenerate",
                "notebookQuiz",
                "notebookGrade",
                "notebookAddSource",
                "docRead",
                "docSummarize",
                "docDiff",
                "docStats",
                "docConvert",
                "audioInfo",
                "audioTranscribe",
                "audioOpen",
                "downloadMedia",
                "slidesCreate",
                "slidesEdit",
                // `as const` keeps the spread a literal, so the whole list
                // still infers as tool names rather than widening to string[].
                ...(androidBridge ? (["deviceAction"] as const) : []),
              ]
            : [],
          instructions: systemPrompt({
            deviceActionsAvailable: Boolean(androidBridge),
            imageRequirement: imageRequirementHint,
            isGuest: userType === "guest",
            requestHints,
            supportsTools,
          }),
          maxOutputTokens: 8192,
          maxRetries: 1,
          messages: modelMessages,
          model: getLanguageModel(chatModel),
          onAbort() {
            logChatObservation("chat_aborted", {
              modelId: chatModel,
              provider,
              requestId,
              totalMs: Date.now() - startedAt,
            });
            stopWaitingStatus();
          },
          onChunk({ chunk }) {
            if (isModelStreamActivity(chunk)) {
              if (isVisibleModelChunk(chunk)) {
                hasVisibleOutput = true;
              }
              if (!hasModelActivity) {
                logChatObservation("chat_first_token", {
                  firstTokenMs: Date.now() - startedAt,
                  modelId: chatModel,
                  provider,
                  requestId,
                });
              }
              markModelActive();
            }
          },
          onEnd() {
            stopWaitingStatus();
          },
          onError({ error }) {
            streamError = error;
            logChatObservation("chat_stream_error", {
              errorClass: errorClass(error),
              modelId: chatModel,
              provider,
              requestId,
              statusCode: errorStatusCode(error),
            });
            stopWaitingStatus();
          },
          prepareStep: ({ steps }) => {
            if (!quizRequested) {
              return {};
            }

            const previous = steps.at(-1);
            const createdNotebook = previous?.toolCalls.some(
              (call) => call?.toolName === "notebookCreate"
            );
            const alreadyQuizzed = previous?.toolCalls.some(
              (call) => call?.toolName === "notebookQuiz"
            );
            const createFailed = previous?.toolResults.some((toolResult) => {
              if (toolResult?.toolName !== "notebookCreate") {
                return false;
              }
              return (
                typeof toolResult.output === "object" &&
                toolResult.output !== null &&
                "error" in toolResult.output
              );
            });

            // The user asked to create a notebook and be quizzed. Models often
            // stop after the first successful tool call, leaving the request
            // half-done; force the quiz step instead of making them ask again.
            if (createdNotebook && !(alreadyQuizzed || createFailed)) {
              return { toolChoice: { toolName: "notebookQuiz", type: "tool" } };
            }

            return {};
          },
          providerOptions: {
            ...(isGeminiModel
              ? {
                  google: {
                    ...(capabilities?.vision
                      ? { mediaResolution: "MEDIA_RESOLUTION_HIGH" }
                      : {}),
                    // Minimal thinking keeps the first token fast; the prompt
                    // carries the deterministic geometry hints that tool
                    // arguments need.
                    thinkingConfig: {
                      thinkingLevel: modelConfig?.thinkingLevel ?? "low",
                    },
                  },
                }
              : {}),
          },
          stopWhen: isStepCount(4),
          streamRetries: 0,
          telemetry: {
            functionId: "stream-text",
            isEnabled:
              isProductionEnvironment &&
              Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
          },
          timeout: {
            chunkMs: 30_000,
            firstChunkMs: 12_000,
            stepMs: 90_000,
            toolMs: 120_000,
            totalMs: 240_000,
          },
          tools: {
            audioInfo: audioInfo({ messages: uiMessages, session }),
            audioOpen: audioOpen({ messages: uiMessages, session }),
            audioTranscribe: audioTranscribe({ messages: uiMessages, session }),
            createDocument: createDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            docConvert: docConvert({ messages: uiMessages, session }),
            docDiff: docDiff({ messages: uiMessages, session }),
            docRead: docRead({ messages: uiMessages, session }),
            docStats: docStats({ messages: uiMessages, session }),
            docSummarize: docSummarize({ messages: uiMessages, session }),
            downloadMedia: downloadMedia({ chatId: id, session }),
            editDocument: editDocument({ dataStream, session }),
            getWeather,
            imageCollage: imageCollage({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageCompress: imageCompress({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageConvert: imageConvert({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageCrop: imageCrop({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              requirement,
              session,
            }),
            imageListPresets: imageListPresets(),
            imageOcr: imageOcr({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageOverlay: imageOverlay({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imagePixelate: imagePixelate({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageRemoveBg: imageRemoveBg({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageResize: imageResize({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              requirement,
              session,
            }),
            imageRotate: imageRotate({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageStitch: imageStitch({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageToPdf: imageToPdf({
              activePdf,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            imageUpscaleEnhance: imageUpscaleEnhance({
              activeImage,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            notebookAddSource: notebookAddSource({
              messages: uiMessages,
              session,
            }),
            notebookAsk: notebookAsk({ session }),
            notebookCreate: notebookCreate({
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            notebookGenerate: notebookGenerate({ session }),
            notebookGrade: notebookGrade({ session }),
            notebookQuiz: notebookQuiz({ session }),
            pdfArrange: pdfArrange({
              activePdf,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            pdfExtractText: pdfExtractText({
              activePdf,
              dataStream,
              messages: uiMessages,
              session,
            }),
            pdfGetInfo: pdfGetInfo({
              activePdf,
              dataStream,
              messages: uiMessages,
              session,
            }),
            pdfMerge: pdfMerge({
              activePdf,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            pdfRotatePages: pdfRotatePages({
              activePdf,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            pdfSplit: pdfSplit({
              activePdf,
              chatId: id,
              dataStream,
              messages: uiMessages,
              session,
            }),
            readUrl: readUrl({ session }),
            requestSuggestions: requestSuggestions({
              dataStream,
              modelId: chatModel,
              session,
            }),
            research: research({ dataStream, session }),
            sheetConvertFormat: sheetConvertFormat({
              activeSheet,
              chatId: id,
              dataStream,
              session,
            }),
            sheetFilterSort: sheetFilterSort({
              activeSheet,
              chatId: id,
              dataStream,
              session,
            }),
            sheetGetInfo: sheetGetInfo({
              activeSheet,
              dataStream,
              session,
            }),
            sheetRemoveDuplicates: sheetRemoveDuplicates({
              activeSheet,
              chatId: id,
              dataStream,
              session,
            }),
            sheetSummaryStats: sheetSummaryStats({
              activeSheet,
              session,
            }),
            slidesCreate: slidesCreate({ session }),
            slidesEdit: slidesEdit({ session }),
            updateDocument: updateDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            webSearch: webSearch({ session }),
            ...(androidBridge ? { deviceAction } : {}),
          },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            stream: withVisibleOutputGuard(result.stream),
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({
              data: title,
              transient: true,
              type: "data-chat-title",
            });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }

        try {
          await result.text;
        } catch (err) {
          /*
           * A provider can fail after it has already streamed the answer.
           * Keep the answer; only turn the turn into an error when nothing
           * visible was produced.
           */
          if (hasVisibleOutput) {
            logChatObservation("chat_late_stream_error", {
              errorClass: errorClass(err),
              modelId: chatModel,
              provider,
              requestId,
              statusCode: errorStatusCode(err),
            });
            return;
          }

          if (streamError) {
            throw streamError;
          }
          throw err;
        } finally {
          const finishReason = await Promise.resolve(result.finishReason).catch(
            () => "error" as const
          );
          const toolCalls = await Promise.resolve(result.toolCalls).catch(
            () => []
          );
          logChatObservation("chat_finished", {
            finishReason: String(finishReason),
            modelId: chatModel,
            provider,
            requestId,
            toolCallCount: toolCalls.length,
            totalMs: Date.now() - startedAt,
          });
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        const validFinishedMessages = finishedMessages.filter((finishedMsg) => {
          if (finishedMsg.role !== "assistant") {
            return true;
          }
          return finishedMsg.parts?.some(
            (p) =>
              p.type === "text" ||
              p.type?.startsWith("tool-") ||
              p.type === "reasoning" ||
              (p as { type?: string }).type === "error"
          );
        });

        if (isToolApprovalFlow) {
          await Promise.all(
            validFinishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (validFinishedMessages.length > 0) {
          await saveMessages({
            messages: validFinishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }
      },
      onError: (error) => {
        const status = errorStatusCode(error);
        const name = errorClass(error);

        logChatObservation("chat_error", {
          errorClass: name,
          modelId: chatModel,
          provider,
          requestId,
          statusCode: status,
        });

        if (name.includes("MissingToolResults")) {
          return "A previous tool call did not finish. It has been cancelled; please retry.";
        }

        if (
          name === "AbortError" ||
          name === "TimeoutError" ||
          name.includes("Timeout")
        ) {
          return "The model took too long to respond. Please retry.";
        }

        if (name === "AI_NoOutputGeneratedError") {
          return "The model returned no output. Please retry or switch models.";
        }

        if (name === "LoadAPIKeyError" || status === 401 || status === 403) {
          return "Gemini API key is missing or invalid. Configure GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.";
        }

        if (
          error instanceof Error &&
          error.message.includes("Gemini is not configured")
        ) {
          return error.message;
        }

        if (
          error instanceof Error &&
          error.message.includes("OPENROUTER_API_KEY")
        ) {
          return "The configured fallback provider is missing OPENROUTER_API_KEY.";
        }

        if (
          status === 402 ||
          (error instanceof Error &&
            (error.message.includes("prepayment credits") ||
              error.message.includes("RESOURCE_EXHAUSTED") ||
              error.message.includes("Insufficient credits")))
        ) {
          return "Gemini API credits are exhausted for this project. Add billing, or enable the configured fallback provider.";
        }

        if (status === 404) {
          return "The selected model is not available. Choose another model.";
        }

        if (status === 429) {
          return "The model is rate-limited right now. Please retry in a moment.";
        }

        return "The AI model could not complete this response. Please retry.";
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      headers: {
        "x-model-id": chatModel,
        "x-model-provider": provider,
        "x-request-id": requestId,
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    logChatObservation("chat_unhandled_error", {
      errorClass: errorClass(error),
      requestId,
      statusCode: errorStatusCode(error),
    });

    console.error("Unhandled error in chat API:", error, {
      requestId,
      vercelId,
    });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
