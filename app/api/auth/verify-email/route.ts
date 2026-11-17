import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { consumeEmailToken } from "@/lib/auth/email-tokens";
import { setEmailVerified } from "@/lib/db/queries";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const allowed = await checkIpRateLimitFor({
    ip,
    key: "email-verify",
    limit: 20,
    windowSeconds: 60 * 60,
  });

  if (!allowed) {
    return redirect(request, "/login?verify=rate_limited");
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";

  if (!token) {
    return redirect(request, "/login?verify=invalid");
  }

  try {
    const userId = await consumeEmailToken({
      purpose: "verify_email",
      token,
    });

    if (!userId) {
      return redirect(request, "/login?verify=invalid");
    }

    const account = await setEmailVerified(userId);

    if (!account) {
      return redirect(request, "/login?verify=invalid");
    }

    return redirect(request, "/login?verified=1");
  } catch {
    return redirect(request, "/login?verify=invalid");
  }
}
