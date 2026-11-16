import { NextResponse } from "next/server";

import { cleanupInactiveGuests } from "@/lib/maintenance/guest-cleanup";
import { cleanupQuickAnswerEvents } from "@/lib/maintenance/quick-answer-cleanup";
import { expireStaleReservations } from "@/lib/usage/ledger";

export const maxDuration = 60;

/**
 * Scheduled maintenance, protected by a bearer secret. It is public at the
 * proxy only for this path; the secret is the actual gate.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "cleanup";

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
