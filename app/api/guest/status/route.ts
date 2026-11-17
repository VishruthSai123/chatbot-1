import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { getMessageCountByUserId } from "@/lib/db/queries";
import { GUEST_MESSAGE_LIMIT } from "@/lib/guest";

/**
 * How many trial messages a guest has left.
 *
 * Guests get a small, account-wide allowance instead of a per-chat one, so the
 * composer can show the signup prompt at exactly the right time.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isGuest =
    session.user.type === "guest" || guestRegex.test(session.user.email ?? "");

  if (!isGuest) {
    return NextResponse.json({
      exhausted: false,
      isGuest: false,
      limit: 0,
      remaining: 0,
      used: 0,
    });
  }

  const used = await getMessageCountByUserId({ id: session.user.id });
  const remaining = Math.max(0, GUEST_MESSAGE_LIMIT - used);

  return NextResponse.json({
    exhausted: remaining === 0,
    isGuest: true,
    limit: GUEST_MESSAGE_LIMIT,
    remaining,
    used,
  });
}
