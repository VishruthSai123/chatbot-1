import { ipAddress } from "@vercel/functions";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

export async function GET(request: Request) {
  const allowed = await checkIpRateLimitFor({
    ip: ipAddress(request),
    key: "guest-create",
    limit: 20,
  });

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many guest sessions. Create a free account to continue." },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const targetPath =
      base && !redirectUrl.startsWith(base)
        ? `${base}${redirectUrl}`
        : redirectUrl;
    return NextResponse.redirect(new URL(targetPath, request.url));
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
