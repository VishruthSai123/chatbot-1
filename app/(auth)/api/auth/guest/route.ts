import { ipAddress } from "@vercel/functions";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { signIn } from "@/app/(auth)/auth";
import { readAuthToken } from "@/lib/auth-token";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

export async function GET(request: NextRequest) {
  // `headers()` marks this route dynamic. Without it, the early 429 branch
  // could be cached and keep blocking guest creation after the limiter resets.
  const requestHeaders = await headers();
  const forwardedIp = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  const allowed = await checkIpRateLimitFor({
    ip: forwardedIp || ipAddress(request),
    key: "guest-create",
    limit: 20,
  });

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many guest sessions. Create a free account to continue." },
      {
        headers: { "Cache-Control": "no-store" },
        status: 429,
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  const token = await readAuthToken(request);

  if (token) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const targetPath =
      base && !redirectUrl.startsWith(base)
        ? `${base}${redirectUrl}`
        : redirectUrl;
    return NextResponse.redirect(new URL(targetPath, request.url), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
