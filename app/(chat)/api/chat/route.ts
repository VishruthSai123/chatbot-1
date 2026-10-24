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
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  audioInfo,
  audioOpen,
  audioTranscribe,
} from "@/lib/ai/tools/audio-tools";
import { createDocument } from "@/lib/ai/tools/create-document";
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
import { updateDocument } from "@/lib/ai/tools/update-document";
import { readUrl, webSearch } from "@/lib/ai/tools/web-search";
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

      messagesFromDb = history.filter((row) => row.id !== message?.id);
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
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
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
    const isGeminiModel = chatModel.includes("gemini");

    const modelMessages = await convertToModelMessages(uiMessages);

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let hasModelActivity = false;
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

        const result = streamText({
          activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
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
                ],
          instructions: systemPrompt({
            imageRequirement: imageRequirementHint,
            requestHints,
            supportsTools,
          }),
          messages: modelMessages,
          model: getLanguageModel(chatModel),
          onAbort() {
            stopWaitingStatus();
          },
          onChunk({ chunk }) {
            if (isModelStreamActivity(chunk)) {
              markModelActive();
            }
          },
          onEnd() {
            stopWaitingStatus();
          },
          onError({ error }) {
            console.error("streamText onError in route:", error);
            stopWaitingStatus();
          },
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
            // Fast models: skip Gemini's "thinking" pass so the first token arrives
            // in ~1s instead of several seconds. The deterministic requirement
            // parser + prompt hints keep tool arguments accurate without it.
            ...(isGeminiModel &&
              !isReasoningModel && {
                google: { thinkingConfig: { thinkingBudget: 0 } },
              }),
          },
          stopWhen: isStepCount(5),
          telemetry: {
            functionId: "stream-text",
            isEnabled:
              isProductionEnvironment &&
              Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
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
            updateDocument: updateDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            webSearch: webSearch({ session }),
          },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            stream: result.stream,
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
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
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
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
        console.error("createUIMessageStream onError:", error);
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        if (
          error instanceof Error &&
          error.message?.includes("Google Generative AI API key is missing")
        ) {
          return "Google Generative AI API key is missing. Please configure GOOGLE_GENERATIVE_AI_API_KEY in your Vercel Project Environment Variables.";
        }
        if (error instanceof Error && error.message) {
          return error.message;
        }
        return "An error occurred while communicating with the AI model.";
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
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
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
