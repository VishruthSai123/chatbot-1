import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getChatById, saveChat, saveMessagesIfAbsent } from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { generateUUID } from "@/lib/utils";

const finalizeSchema = z.object({
  chatId: z.uuid().optional(),
  turns: z
    .array(
      z.object({
        id: z.uuid(),
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(8000),
      })
    )
    .min(1)
    .max(60),
});

function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 48
    ? `${normalized.slice(0, 45).trimEnd()}…`
    : normalized || "Live conversation";
}

/**
 * Persists a completed realtime Live transcript to a normal Spire chat.
 *
 * The client sends every finished turn after each turn, so this endpoint must be
 * idempotent. Message IDs are the client turn IDs and duplicates are ignored.
 */
export async function handleLiveFinalizeRequest(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let input: z.infer<typeof finalizeSchema>;
  try {
    input = finalizeSchema.parse(await request.json());
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Invalid live transcript."
    ).toResponse();
  }

  const uniqueTurns = Array.from(
    new Map(input.turns.map((turn) => [turn.id, turn])).values()
  );
  const firstUserTurn = uniqueTurns.find((turn) => turn.role === "user");

  let { chatId } = input;

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
      title: titleFromText(firstUserTurn?.text ?? "Live conversation"),
      userId: session.user.id,
      visibility: "private",
    });
  }

  const now = Date.now();
  const messages: DBMessage[] = uniqueTurns.map((turn, index) => ({
    attachments: [],
    chatId,
    createdAt: new Date(now + index),
    id: turn.id,
    parts: [{ text: turn.text, type: "text" }] as DBMessage["parts"],
    role: turn.role,
  }));

  try {
    await saveMessagesIfAbsent({ messages });
  } catch (error) {
    console.error("Live transcript save failed:", error);
    return Response.json(
      { error: "live_save_failed" },
      { headers: { "Cache-Control": "no-store" }, status: 500 }
    );
  }

  return Response.json(
    { chatId },
    { headers: { "Cache-Control": "no-store" } }
  );
}
