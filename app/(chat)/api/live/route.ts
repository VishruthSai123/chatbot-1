import { ipAddress } from "@vercel/functions";
import { type ModelMessage, streamText } from "ai";
import { and, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getLanguageModel } from "@/lib/ai/providers";
import { guestRegex } from "@/lib/constants";
import { db } from "@/lib/db/client";
import {
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import { type DBMessage, liveSession } from "@/lib/db/schema";
import { getEntitlement } from "@/lib/entitlements";
import { ChatbotError } from "@/lib/errors";
import { handleLiveFinalizeRequest } from "@/lib/live/finalize";
import { handleLiveTokenRequest } from "@/lib/live/token";
import { checkIpRateLimitFor } from "@/lib/ratelimit";
import { usageRailsEnabled } from "@/lib/usage/config";
import { expireStaleReservations } from "@/lib/usage/ledger";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 60;

const liveRequestSchema = z.object({
  chatId: z.uuid().optional(),
  locale: z.string().max(40).optional(),
  text: z.string().trim().min(1).max(2000),
});

const liveSystemPrompt = `You are Spire Live, a voice assistant inside Quick Search. Reply for speech: 1-2 short sentences, ideally under 30 words, plain text only, no markdown, no code blocks, no bullet lists. If the user asks for a long explanation, give the short answer and offer to open Spire for details. Do not claim to see the screen or the user's device. Ask one short clarifying question if needed. Keep the established conversation language by default. If the user's very first complete utterance is clearly in a different language, follow that language. After that, switch only when the user speaks at least two complete, consecutive turns in the new language. Never switch because of a single foreign word, a name, an accent, a misheard phrase, background speech, or an uncertain transcription. When in doubt, keep the established language.`;

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .filter((part): part is { text: string; type: "text" } =>
      Boolean(
        part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
      )
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 48
    ? `${normalized.slice(0, 45).trimEnd()}…`
    : normalized || "Live conversation";
}

async function handleLiveChatRequest(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  if (
    session.user.type === "guest" ||
    guestRegex.test(session.user.email ?? "")
  ) {
    return new ChatbotError("auth_required:chat").toResponse();
  }

  let input: z.infer<typeof liveRequestSchema>;
  try {
    input = liveRequestSchema.parse(await request.json());
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Invalid live request."
    ).toResponse();
  }

  const plan = await getEntitlement(session.user.id);
  const messageCount = await getMessageCountByUserId({
    differenceInHours: 1,
    id: session.user.id,
  });

  if (messageCount > plan.messagesPerHour) {
    return new ChatbotError("rate_limit:chat").toResponse();
  }

  const { chatId: requestedChatId } = input;
  let chatId = requestedChatId;

  if (chatId) {
    const existing = await getChatById({ id: chatId });
    if (!existing) {
      return new ChatbotError("not_found:chat").toResponse();
    }
    if (existing.userId !== session.user.id) {
      return new ChatbotError("forbidden:chat").toResponse();
    }
  } else {
    chatId = generateUUID();
    await saveChat({
      id: chatId,
      title: titleFromText(input.text),
      userId: session.user.id,
      visibility: "private",
    });
  }

  const userMessage: DBMessage = {
    attachments: [],
    chatId,
    createdAt: new Date(),
    id: generateUUID(),
    parts: [{ text: input.text, type: "text" }] as DBMessage["parts"],
    role: "user",
  };

  await saveMessages({ messages: [userMessage] });

  const history = await getMessagesByChatId({ id: chatId });
  const modelMessages: ModelMessage[] = history
    .slice(-12)
    .map((message) => ({
      content: textFromParts(message.parts),
      role:
        message.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
    }))
    .filter((message) => message.content.length > 0);

  const result = streamText({
    maxOutputTokens: 420,
    maxRetries: 1,
    messages: modelMessages,
    model: getLanguageModel(),
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    },
    system: input.locale
      ? `${liveSystemPrompt}\nThe user's locale is ${input.locale}. Treat it as the established conversation language.`
      : liveSystemPrompt,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      };

      send({ chatId, type: "chat" });

      let assistantText = "";
      let failed = false;

      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            assistantText += part.text;
            send({ text: part.text, type: "delta" });
          } else if (part.type === "error") {
            throw part.error;
          } else if (part.type === "abort") {
            throw new Error("Live stream aborted");
          }
        }

        const finalText = assistantText.trim();

        if (finalText) {
          try {
            await saveMessages({
              messages: [
                {
                  attachments: [],
                  chatId,
                  createdAt: new Date(),
                  id: generateUUID(),
                  parts: [
                    { text: finalText, type: "text" },
                  ] as DBMessage["parts"],
                  role: "assistant",
                },
              ],
            });
          } catch (error) {
            console.error("Live assistant message save failed:", error);
          }
        } else {
          failed = true;
          console.error("Live stream produced no text");
          send({
            message: "Spire returned an empty reply. Please try again.",
            type: "error",
          });
        }
      } catch (error) {
        failed = true;
        console.error("Live stream failed:", error);
        send({
          message: "Spire couldn't finish that reply. Please try again.",
          type: "error",
        });
      } finally {
        if (!failed) {
          send({ chatId, type: "done" });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * One serverless function for the whole Live family.
 *
 * Vercel Hobby allows twelve functions per deployment, and the app already uses
 * all twelve. `?action=token` and `?action=finalize` therefore share this route
 * rather than each adding a function. The chat path remains the default so the
 * existing Android client URL keeps working unchanged.
 */
async function handleExpireRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!(secret && authorization === `Bearer ${secret}`)) {
    return Response.json(
      { error: "unauthorized" },
      { headers: { "Cache-Control": "no-store" }, status: 401 }
    );
  }

  if (!usageRailsEnabled()) {
    return Response.json(
      { error: "usage_rails_disabled" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const result = await expireStaleReservations(500);
  const expiredSessions = await db
    .update(liveSession)
    .set({ endedAt: new Date(), status: "expired" })
    .where(
      and(
        inArray(liveSession.status, ["reserved", "active"]),
        lt(liveSession.expireAt, new Date())
      )
    )
    .returning({ id: liveSession.id });

  return Response.json(
    { ...result, expiredSessions: expiredSessions.length },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function GET(request: Request) {
  const action = new URL(request.url).searchParams.get("action");

  if (action === "expire") {
    return await handleExpireRequest(request);
  }

  return Response.json(
    { error: "not_found" },
    { headers: { "Cache-Control": "no-store" }, status: 404 }
  );
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get("action");

  if (action === "expire") {
    return await handleExpireRequest(request);
  }

  if (action === "token") {
    const allowed = await checkIpRateLimitFor({
      ip: ipAddress(request),
      key: "live-token",
      limit: 10,
    });

    if (!allowed) {
      return Response.json(
        { error: "live_rate_limited" },
        { headers: { "Cache-Control": "no-store" }, status: 429 }
      );
    }

    return await handleLiveTokenRequest();
  }

  if (action === "finalize") {
    return await handleLiveFinalizeRequest(request);
  }

  return await handleLiveChatRequest(request);
}
