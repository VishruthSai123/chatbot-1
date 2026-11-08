import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { safeNextPath } from "./lib/auth/next";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

/**
 * Paths that must stay public even without a session.
 *
 * `/.well-known/assetlinks.json` is fetched by Chrome's Digital Asset Links
 * verifier (for TWA/App Links), and manifest/service-worker/icon requests come
 * from install checks and browsers that do not carry the chat session. Sending
 * them through guest login would turn them into redirects.
 */
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/.well-known/",
  "/149e9513-",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons/",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
] as const;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (!token) {
    // Keep the query string: Android deep links (`?query=`, `?draft=`,
    // `?share=`) arrive on a cold start before the guest cookie exists.
    const requested = new URL(request.url);
    const redirectUrl = encodeURIComponent(
      `${requested.pathname}${requested.search}`
    );

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
    // An already-signed-in visitor who followed a `?next=` link goes where the
    // link pointed, not to the home page.
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const target = new URL(`${base}${next}`, request.url);

    if (request.nextUrl.searchParams.get("embed") === "android") {
      target.searchParams.set("embed", "android");
    }

    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
