import { createHash } from "node:crypto";

import { ipAddress } from "@vercel/functions";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getLanguageModel } from "@/lib/ai/providers";
import { db } from "@/lib/db/client";
import { quickAnswerEvent } from "@/lib/db/schema";
import { checkIpRateLimitFor } from "@/lib/ratelimit";
import {
  getUsageSummary,
  QuotaExceededError,
  release,
  reserve,
  settle,
} from "@/lib/usage/ledger";
import { periodBounds } from "@/lib/usage/periods";
import { chatCost } from "@/lib/usage/pricing";

export const maxDuration = 30;

const QUICK_ANSWER_MODEL = "gemini-3.1-flash-lite";
const DAILY_LIMIT = 5;
const MAX_QUERY_CHARS = 500;

const requestSchema = z.object({
  installId: z.uuid(),
  query: z.string().trim().min(2).max(MAX_QUERY_CHARS),
});

const systemPrompt = `You are Spire Quick Answer.
Reply in one short paragraph, at most two sentences, plain text only. No markdown, bullets, headings or code fences.
Answer the question directly. If it needs live or current data you cannot verify, say so briefly instead of guessing.`;

function hashIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return;
  }
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "A query and install id are required." },
      { status: 400 }
    );
  }

  const ip = ipAddress(request);
  const ipHash = hashIp(ip);
  const allowedByIp = await checkIpRateLimitFor({
    ip: ipHash,
    key: "quick-answer",
    limit: 20,
    windowSeconds: 24 * 60 * 60,
  });

  if (!allowedByIp) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "Too many quick answers from this connection. Try again tomorrow.",
      },
      { status: 429 }
    );
  }

  let reservation: Awaited<ReturnType<typeof reserve>>;
  try {
    reservation = await reserve({
      amount: 1,
      kind: "quick_answers",
      limit: DAILY_LIMIT,
      period: "day",
      subjectId: body.installId,
      subjectType: "device",
      ttlSeconds: 60,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          limit: error.details.limit,
          message:
            "You have used today's 5 free Spire quick answers. Add your own API key for unlimited AI search, or come back tomorrow.",
          remaining: 0,
          resetAt: error.details.resetAt,
        },
        { status: 429 }
      );
    }
    throw error;
  }

  try {
    const result = await generateText({
      maxOutputTokens: 250,
      model: getLanguageModel(QUICK_ANSWER_MODEL),
      prompt: body.query,
      system: systemPrompt,
      temperature: 0.4,
    });

    const inputTokens = Math.max(0, result.usage?.inputTokens ?? 0);
    const outputTokens = Math.max(0, result.usage?.outputTokens ?? 0);
    const cachedTokens = Math.max(
      0,
      (result.usage as { cachedInputTokens?: number | null })
        ?.cachedInputTokens ?? 0
    );
    const costUsd = chatCost({
      cachedTokens,
      inputTokens,
      lane: "standard",
      model: QUICK_ANSWER_MODEL,
      outputTokens,
    });

    await settle({ amount: 1, reservationId: reservation.id });

    await db
      .insert(quickAnswerEvent)
      .values({
        costUsd: String(costUsd),
        inputTokens,
        installId: body.installId,
        ipHash,
        model: QUICK_ANSWER_MODEL,
        outputTokens,
      })
      .catch((error) => {
        console.error("Quick answer event write failed:", error);
      });

    const summary = await getUsageSummary({
      subjectId: body.installId,
      subjectType: "device",
    });
    const counter = summary.find(
      (row) => row.kind === "quick_answers" && row.period === "day"
    );
    const remaining = Math.max(
      0,
      (counter?.limit ?? DAILY_LIMIT) -
        (counter?.used ?? 0) -
        (counter?.reserved ?? 0)
    );

    return NextResponse.json({
      answer: result.text.trim(),
      model: "spire-quick",
      remaining,
      resetAt: (counter?.periodEnd ?? periodBounds("day").end).toISOString(),
    });
  } catch (error) {
    await release(reservation.id).catch(() => undefined);
    console.error("Quick answer provider failed:", error);
    return NextResponse.json(
      {
        error: "quick_answer_unavailable",
        message: "Spire could not answer that right now. Try again shortly.",
      },
      { status: 502 }
    );
  }
}
