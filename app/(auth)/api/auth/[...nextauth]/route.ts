import { ipAddress } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";

import { GET as authGET, POST as authPOST } from "@/app/(auth)/auth";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

export const GET = authGET;

/**
 * Credential callbacks are a brute-force target. The server actions cover the
 * normal login form; this also covers direct posts to Next Auth's callback.
 */
export async function POST(request: NextRequest) {
  const allowed = await checkIpRateLimitFor({
    ip: ipAddress(request),
    key: "auth-post",
    limit: 20,
    windowSeconds: 5 * 60,
  });

  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Too many sign-in attempts. Please wait a few minutes and try again.",
      },
      { status: 429 }
    );
  }

  return authPOST(request);
}
