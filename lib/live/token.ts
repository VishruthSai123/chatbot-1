import { and, eq, inArray } from "drizzle-orm";

import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { liveSession } from "@/lib/db/schema";
import { getEntitlement } from "@/lib/entitlements";
import { ChatbotError } from "@/lib/errors";
import { checkLiveCapacity } from "@/lib/live/concurrency";
import { liveEnabled, usageRailsEnabled } from "@/lib/usage/config";
import {
  expireStaleReservations,
  getUsageSummary,
  QuotaExceededError,
  release,
  reserve,
} from "@/lib/usage/ledger";

const DEFAULT_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest";
const TOKEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const MAX_TOKEN_SECONDS = 20 * 60;
const MIN_TOKEN_SECONDS = 60;

type AuthTokenResponse = {
  name?: string;
};

type TokenAttempt = {
  body: Record<string, unknown>;
  detail?: string;
  ok: boolean;
  status?: number;
};

async function requestToken(
  apiKey: string,
  body: Record<string, unknown>
): Promise<TokenAttempt> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
    });

    if (!response.ok) {
      return {
        body,
        detail: (await response.text()).slice(0, 400),
        ok: false,
        status: response.status,
      };
    }

    const data = (await response.json()) as AuthTokenResponse;
    if (!data.name) {
      return { body, detail: "missing token name", ok: false, status: 502 };
    }

    return { body, detail: data.name, ok: true };
  } catch (error) {
    return {
      body,
      detail: error instanceof Error ? error.message : "token request failed",
      ok: false,
    };
  }
}

function quotaResponse(error: QuotaExceededError) {
  return Response.json(
    {
      error: "quota_exceeded",
      kind: error.details.kind,
      limit: error.details.limit,
      period: error.details.period,
      reserved: error.details.reserved,
      resetAt: error.details.resetAt,
      used: error.details.used,
    },
    { headers: { "Cache-Control": "no-store" }, status: 429 }
  );
}

async function reserveLiveSeconds(userId: string, limitSeconds: number) {
  // The token is valid only for the reserved amount. Reserve the whole possible
  // session so a disconnect or a lost finalize cannot leave the last minutes
  // unbooked.
  const desired = Math.min(
    MAX_TOKEN_SECONDS,
    Math.max(MIN_TOKEN_SECONDS, Math.floor(limitSeconds))
  );

  try {
    return await reserve({
      amount: desired,
      kind: "live_seconds",
      limit: limitSeconds,
      period: "month",
      subjectId: userId,
      ttlSeconds: MAX_TOKEN_SECONDS,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      const remaining = Math.max(
        0,
        Math.floor(
          error.details.limit - error.details.used - error.details.reserved
        )
      );
      if (remaining >= MIN_TOKEN_SECONDS) {
        return await reserve({
          amount: remaining,
          kind: "live_seconds",
          limit: limitSeconds,
          period: "month",
          subjectId: userId,
          ttlSeconds: MAX_TOKEN_SECONDS,
        });
      }
    }
    throw error;
  }
}

async function mintToken(apiKey: string, model: string, maxSeconds: number) {
  const now = Date.now();
  const durationSeconds = Math.min(
    MAX_TOKEN_SECONDS,
    Math.max(MIN_TOKEN_SECONDS, Math.floor(maxSeconds))
  );
  const expireTime = new Date(now + durationSeconds * 1000).toISOString();
  const newSessionExpireTime = new Date(
    now + Math.min(2 * 60, durationSeconds) * 1000
  ).toISOString();

  const constrainedBody = {
    expireTime,
    liveConnectConstraints: { model },
    newSessionExpireTime,
    uses: 1,
  };

  let attempt = await requestToken(apiKey, constrainedBody);

  // Older/alternate Gemini keys reject `liveConnectConstraints`. The client
  // still sends a full setup message, so a plain token is a safe fallback.
  if (!attempt.ok && (attempt.status === 400 || attempt.status === 404)) {
    attempt = await requestToken(apiKey, {
      expireTime,
      newSessionExpireTime,
      uses: 1,
    });
  }

  return { attempt, expireTime };
}

/**
 * Mints a single-use Gemini Live ephemeral token so the Android client can open
 * a direct WebSocket. A serverless proxy cannot carry full-duplex audio, and
 * the raw production key must never reach the device.
 *
 * With USAGE_RAILS_ENABLED=true, the token is also backed by a reservation and
 * a LiveSession row. With the flag off, this preserves the previous behaviour
 * so local Live testing keeps working before the migration is applied.
 */
export async function handleLiveTokenRequest() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  if (
    session.user.type === "guest" ||
    guestRegex.test(session.user.email ?? "")
  ) {
    return Response.json(
      {
        error: "auth_required",
        message:
          "Create a free account to use Spire Live. Quick Search local search stays free and needs no account.",
        requiresAuth: true,
      },
      { headers: { "Cache-Control": "no-store" }, status: 403 }
    );
  }

  if (!liveEnabled()) {
    return Response.json(
      { error: "live_disabled" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      { error: "live_not_configured" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;

  if (!usageRailsEnabled()) {
    const { attempt, expireTime } = await mintToken(
      apiKey,
      model,
      MAX_TOKEN_SECONDS
    );
    if (!(attempt.ok && attempt.detail)) {
      console.error(
        "Live token request failed:",
        attempt.status,
        attempt.detail
      );
      return Response.json(
        { error: "live_token_unavailable" },
        { headers: { "Cache-Control": "no-store" }, status: 503 }
      );
    }

    return Response.json(
      { expiresAt: expireTime, model, token: attempt.detail },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const plan = await getEntitlement(session.user.id);
  const limitSeconds = Math.max(0, Math.floor(plan.liveMinutesPerMonth * 60));
  const requestNow = new Date();
  const resetAt = new Date(
    Date.UTC(requestNow.getUTCFullYear(), requestNow.getUTCMonth() + 1, 1)
  ).toISOString();

  if (limitSeconds <= 0) {
    return Response.json(
      {
        error: "quota_exceeded",
        kind: "live_seconds",
        limit: 0,
        period: "month",
        reserved: 0,
        resetAt,
        used: 0,
      },
      { headers: { "Cache-Control": "no-store" }, status: 429 }
    );
  }

  // Fail-safe if the external cron is late: clean stale holds before checking
  // for an active session, otherwise an abandoned token blocks a new one.
  await expireStaleReservations(50).catch((error) => {
    console.error("Live stale reservation cleanup failed:", error);
  });

  const [active] = await db
    .select({ id: liveSession.id })
    .from(liveSession)
    .where(
      and(
        eq(liveSession.userId, session.user.id),
        inArray(liveSession.status, ["reserved", "active"])
      )
    )
    .limit(1);

  if (active) {
    return Response.json(
      { error: "live_session_active", sessionId: active.id },
      { headers: { "Cache-Control": "no-store" }, status: 409 }
    );
  }

  try {
    const capacity = await checkLiveCapacity();
    if (!capacity.ok) {
      return Response.json(
        {
          active: capacity.active,
          error: "live_capacity",
          max: capacity.max,
          retryAfterSeconds: 5,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
          status: 503,
        }
      );
    }
  } catch (error) {
    console.error("Live capacity check failed:", error);
    return Response.json(
      { error: "live_capacity_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  let reservation: Awaited<ReturnType<typeof reserveLiveSeconds>>;
  try {
    reservation = await reserveLiveSeconds(session.user.id, limitSeconds);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return quotaResponse(error);
    }
    console.error("Live reservation failed:", error);
    return Response.json(
      { error: "usage_rails_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const { attempt, expireTime } = await mintToken(
    apiKey,
    model,
    reservation.amount
  );

  if (!(attempt.ok && attempt.detail)) {
    await release(reservation.id);
    console.error("Live token request failed:", attempt.status, attempt.detail);
    return Response.json(
      { error: "live_token_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  let sessionId: string;
  try {
    const [created] = await db
      .insert(liveSession)
      .values({
        expireAt: new Date(expireTime),
        model,
        reservationId: reservation.id,
        reservedSeconds: Math.round(reservation.amount),
        startedAt: new Date(),
        status: "reserved",
        tokenName: attempt.detail,
        userId: session.user.id,
      })
      .returning({ id: liveSession.id });
    sessionId = created.id;
  } catch (error) {
    await release(reservation.id);
    console.error("Live session record failed:", error);
    return Response.json(
      { error: "live_session_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const summary = await getUsageSummary({ subjectId: session.user.id });
  const liveCounter = summary.find(
    (counter) => counter.kind === "live_seconds" && counter.period === "month"
  );
  const remainingSeconds = liveCounter
    ? Math.max(0, liveCounter.limit - liveCounter.used - liveCounter.reserved)
    : 0;

  return Response.json(
    {
      expiresAt: expireTime,
      model,
      remainingSeconds,
      reservedSeconds: Math.round(reservation.amount),
      sessionId,
      token: attempt.detail,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
