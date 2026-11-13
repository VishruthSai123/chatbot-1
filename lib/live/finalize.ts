import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/client";
import { getChatById, saveChat, saveMessagesIfAbsent } from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { liveSession } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { settle } from "@/lib/usage/ledger";
import { liveCost } from "@/lib/usage/pricing";
import { generateUUID } from "@/lib/utils";

const finalizeSchema = z.object({
  chatId: z.uuid().optional(),
  ended: z.boolean().optional(),
  reason: z.string().max(80).optional(),
  seconds: z
    .number()
    .finite()
    .min(0)
    .max(4 * 60 * 60)
    .optional(),
  sessionId: z.uuid().optional(),
  turns: z
    .array(
      z.object({
        id: z.uuid(),
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(8000),
      })
    )
    .max(60)
    .default([]),
});

function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 48
    ? `${normalized.slice(0, 45).trimEnd()}…`
    : normalized || "Live conversation";
}

async function settleLiveSession(input: {
  reason?: string;
  seconds?: number;
  sessionId?: string;
  userId: string;
}) {
  const [session] = input.sessionId
    ? await db
        .select()
        .from(liveSession)
        .where(
          and(
            eq(liveSession.id, input.sessionId),
            eq(liveSession.userId, input.userId)
          )
        )
        .limit(1)
    : await db
        .select()
        .from(liveSession)
        .where(
          and(
            eq(liveSession.userId, input.userId),
            inArray(liveSession.status, ["reserved", "active"])
          )
        )
        .orderBy(desc(liveSession.createdAt))
        .limit(1);

  if (!session) {
    return null;
  }

  if (session.status === "finalized" || session.status === "expired") {
    return {
      costUsd: Number(session.costUsd),
      seconds: session.actualSeconds,
    };
  }

  const elapsedSeconds = session.startedAt
    ? Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000)
    : session.reservedSeconds;
  const seconds = Math.max(
    0,
    Math.min(
      Math.round(input.seconds ?? elapsedSeconds),
      session.reservedSeconds
    )
  );
  const costUsd = liveCost({ model: session.model, seconds });

  await settle({
    amount: seconds,
    event: {
      costUsd,
      idempotencyKey: `live:${session.id}:finalize`,
      kind: "live_audio",
      liveSeconds: seconds,
      metadata: { reason: input.reason ?? "client_finalize" },
      model: session.model,
      userId: input.userId,
    },
    reservationId: session.reservationId,
  });

  await db
    .update(liveSession)
    .set({
      actualSeconds: seconds,
      costUsd: String(costUsd),
      endedAt: new Date(),
      status: "finalized",
    })
    .where(eq(liveSession.id, session.id));

  return { costUsd, seconds };
}

/**
 * Persists a completed realtime Live transcript to a normal Spire chat and
 * settles the Live reservation.
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

  const settlement = input.ended
    ? await settleLiveSession({
        reason: input.reason,
        seconds: input.seconds,
        sessionId: input.sessionId,
        userId: session.user.id,
      }).catch((error) => {
        console.error("Live settlement failed:", error);
        return null;
      })
    : null;

  const uniqueTurns = Array.from(
    new Map(input.turns.map((turn) => [turn.id, turn])).values()
  );
  const firstUserTurn = uniqueTurns.find((turn) => turn.role === "user");
  let { chatId } = input;

  if (uniqueTurns.length === 0) {
    return Response.json(
      {
        chatId: chatId ?? null,
        costUsd: settlement?.costUsd ?? 0,
        settledSeconds: settlement?.seconds ?? 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

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
    chatId: chatId as string,
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
    {
      chatId,
      costUsd: settlement?.costUsd ?? 0,
      settledSeconds: settlement?.seconds ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
