import { createHash } from "node:crypto";

import { ipAddress } from "@vercel/functions";
import { generateText } from "ai";
import { gte, sql } from "drizzle-orm";
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
import { periodBounds, type UsagePeriod } from "@/lib/usage/periods";
import { chatCost } from "@/lib/usage/pricing";

export const maxDuration = 30;

const QUICK_ANSWER_MODEL = "gemini-3.1-flash-lite";
const MAX_QUERY_CHARS = 500;

type QuotaScope = UsagePeriod;

/**
 * The monthly allowance is the visible budget. The weekly and daily caps are
 * fair-use guardrails: they stay hidden until one is reached, so a user can
 * spend the month early without seeing a counter after every answer.
 */
const LIMITS: Record<QuotaScope, number> = {
  day: positiveIntEnv("QUICK_ANSWER_DAILY_LIMIT", 10),
  month: positiveIntEnv("QUICK_ANSWER_MONTHLY_LIMIT", 150),
  week: positiveIntEnv("QUICK_ANSWER_WEEKLY_LIMIT", 50),
};

const QUOTA_KINDS: Record<QuotaScope, string> = {
  day: "quick_answers_day",
  month: "quick_answers_month",
  week: "quick_answers_week",
};

/** Check the most expensive window first so a used-up month fails fast. */
const RESERVE_ORDER: QuotaScope[] = ["month", "week", "day"];

const IP_DAILY_LIMIT = positiveIntEnv("QUICK_ANSWER_IP_DAILY_LIMIT", 40);
const DAILY_COST_CAP_USD = nonNegativeNumberEnv(
  "QUICK_ANSWER_DAILY_COST_CAP_USD",
  5
);

const requestSchema = z.object({
  installId: z.uuid(),
  query: z.string().trim().min(2).max(MAX_QUERY_CHARS),
});

const systemPrompt = `You are Spire Quick Answer.
Reply in one short paragraph, at most two sentences, plain text only. No markdown, bullets, headings or code fences.
Answer the question directly. If it needs live or current data you cannot verify, say so briefly instead of guessing.`;

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function quickAnswersEnabled(): boolean {
  return (process.env.QUICK_ANSWER_ENABLED ?? "true").toLowerCase() !== "false";
}

function hashIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return;
  }
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function retryAfterSeconds(resetAt: string): number {
  const seconds = Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000);
  return Math.max(60, seconds);
}

function formatResetDate(resetAt: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(resetAt));
}

function quotaMessage(scope: QuotaScope, limit: number, resetAt: string) {
  const reset = formatResetDate(resetAt);

  if (scope === "month") {
    return `You've used this month's ${limit} included Spire answers. They reset on ${reset}. Add your own API key for unlimited AI search.`;
  }

  if (scope === "week") {
    return `You've used this week's included Spire answers. They reset on ${reset}. Add your own API key for unlimited AI search.`;
  }

  return `You've used today's included Spire answers. They reset on ${reset}. Add your own API key for unlimited AI search.`;
}

async function dailySpendUsd(): Promise<number> {
  const { start } = periodBounds("day");
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${quickAnswerEvent.costUsd}), 0)`,
    })
    .from(quickAnswerEvent)
    .where(gte(quickAnswerEvent.createdAt, start));

  return Number(row?.total ?? 0);
}

async function reserveQuotaCounters(
  scopes: QuotaScope[],
  installId: string,
  reserved: Array<{ id: string; scope: QuotaScope }>
): Promise<void> {
  const [scope, ...rest] = scopes;

  if (!scope) {
    return;
  }

  const reservation = await reserve({
    amount: 1,
    kind: QUOTA_KINDS[scope],
    limit: LIMITS[scope],
    period: scope,
    subjectId: installId,
    subjectType: "device",
    ttlSeconds: 60,
  });

  reserved.push({ id: reservation.id, scope });
  await reserveQuotaCounters(rest, installId, reserved);
}

async function releaseReservations(
  reservations: Array<{ id: string }>
): Promise<void> {
  await Promise.allSettled(
    reservations.map((reservation) => release(reservation.id))
  );
}

export async function POST(request: Request) {
  if (!quickAnswersEnabled()) {
    return NextResponse.json(
      {
        error: "quick_answer_disabled",
        message:
          "Spire quick answers are taking a short break. Try again later.",
      },
      { status: 503 }
    );
  }

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
    limit: IP_DAILY_LIMIT,
    windowSeconds: 24 * 60 * 60,
  });

  if (!allowedByIp) {
    const resetAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return NextResponse.json(
      {
        error: "rate_limited",
        limit: IP_DAILY_LIMIT,
        message:
          "Too many Spire quick answers from this connection. Try again later, or add your own API key.",
        remaining: 0,
        resetAt,
        scope: "ip",
      },
      {
        headers: { "Retry-After": String(retryAfterSeconds(resetAt)) },
        status: 429,
      }
    );
  }

  if (DAILY_COST_CAP_USD > 0) {
    const spent = await dailySpendUsd();

    if (spent >= DAILY_COST_CAP_USD) {
      console.error("Quick answer daily cost cap reached.");
      return NextResponse.json(
        {
          error: "budget_exhausted",
          message:
            "Spire quick answers are taking a short break. Try again later.",
        },
        { status: 503 }
      );
    }
  }

  const reservations: Array<{ id: string; scope: QuotaScope }> = [];

  try {
    await reserveQuotaCounters(RESERVE_ORDER, body.installId, reservations);
  } catch (error) {
    await releaseReservations(reservations);

    if (error instanceof QuotaExceededError) {
      const scope = error.details.period as QuotaScope;
      const { limit, resetAt } = error.details;

      return NextResponse.json(
        {
          error: "quota_exceeded",
          limit,
          message: quotaMessage(scope, limit, resetAt),
          remaining: 0,
          resetAt,
          scope,
        },
        {
          headers: { "Retry-After": String(retryAfterSeconds(resetAt)) },
          status: 429,
        }
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

    const settled = await Promise.allSettled(
      reservations.map((reservation) =>
        settle({ amount: 1, reservationId: reservation.id })
      )
    );

    if (settled.some((entry) => entry.status === "rejected")) {
      console.error("Some quick-answer quota holds could not be settled.");
    }

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
    const monthly = summary.find(
      (row) => row.kind === QUOTA_KINDS.month && row.period === "month"
    );
    const monthlyRemaining = Math.max(
      0,
      LIMITS.month - (monthly?.used ?? 0) - (monthly?.reserved ?? 0)
    );
    const monthlyResetAt = (
      monthly?.periodEnd ?? periodBounds("month").end
    ).toISOString();

    return NextResponse.json({
      answer: result.text.trim(),
      model: "spire-quick",
      quota: {
        limit: LIMITS.month,
        remaining: monthlyRemaining,
        resetAt: monthlyResetAt,
        scope: "month",
      },
      // Kept for older clients that only read the flat fields.
      remaining: monthlyRemaining,
      resetAt: monthlyResetAt,
    });
  } catch (error) {
    await releaseReservations(reservations);
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
