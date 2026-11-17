import { timingSafeEqual } from "node:crypto";

import { like } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { rateLimit } from "@/lib/db/schema";
import { emailConfiguration } from "@/lib/email/send";
import { cleanupInactiveGuests } from "@/lib/maintenance/guest-cleanup";
import { cleanupQuickAnswerEvents } from "@/lib/maintenance/quick-answer-cleanup";
import { expireStaleReservations } from "@/lib/usage/ledger";

export const maxDuration = 60;

/**
 * Scheduled maintenance, protected by a bearer secret. It is public at the
 * proxy only for this path; the secret is the actual gate.
 */
function authorized(authorization: string): boolean {
  const expected = [
    process.env.CRON_SECRET,
    process.env.MAINTENANCE_CLEANUP_TOKEN,
  ].filter((value): value is string => Boolean(value));

  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!provided) {
    return false;
  }

  return expected.some((secret) => {
    const left = Buffer.from(secret);
    const right = Buffer.from(provided);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (!authorized(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "cleanup";

  if (action === "clear-guest-rate-limits") {
    const cleared = await db
      .delete(rateLimit)
      .where(like(rateLimit.key, "ip-rate-limit:guest-create:%"))
      .returning({ key: rateLimit.key });

    return NextResponse.json(
      { action, cleared: cleared.length, success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (action === "email-status") {
    const config = emailConfiguration();
    let domains: Array<{ name?: string; status?: string }> = [];
    let providerStatus = 0;

    if (config.apiKeyPresent) {
      try {
        const response = await fetch("https://api.resend.com/domains", {
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
          },
          signal: AbortSignal.timeout(10_000),
        });
        providerStatus = response.status;

        if (response.ok) {
          const body = (await response.json()) as {
            data?: Array<{ name?: string; status?: string }>;
          };
          domains = (body.data ?? []).map((domain) => ({
            name: domain.name,
            status: domain.status,
          }));
        }
      } catch {
        providerStatus = 0;
      }
    }

    return NextResponse.json(
      {
        action,
        config,
        domains,
        providerStatus,
        success: providerStatus === 200,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (action === "guest-rate-limit-status") {
    const rows = await db
      .select({
        count: rateLimit.count,
        key: rateLimit.key,
        windowStart: rateLimit.windowStart,
      })
      .from(rateLimit)
      .where(like(rateLimit.key, "ip-rate-limit:guest-create:%"));

    return NextResponse.json(
      {
        action,
        rows: rows.map((row) => ({
          count: row.count,
          keyTail: row.key.slice(-8),
          windowStart: row.windowStart,
        })),
        success: true,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (action !== "cleanup") {
    return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  }

  const requestedLimit = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50;

  const result = await cleanupInactiveGuests({
    inactivityDays: 7,
    limit,
  });
  const quickAnswerCleanup = await cleanupQuickAnswerEvents({
    limit: 5000,
    olderThanDays: 90,
  });
  const expiredReservations = await expireStaleReservations(200);

  return NextResponse.json(
    {
      action,
      expiredReservations,
      quickAnswerCleanup,
      result,
      success: result.errors === 0 && quickAnswerCleanup.errors === 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
