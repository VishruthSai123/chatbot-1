import "server-only";

import { headers } from "next/headers";

/**
 * The public origin used in auth email links.
 *
 * `APP_URL` is preferred so a link generated inside a preview deployment points
 * at the canonical site. Otherwise the request's forwarded host is used, which
 * keeps local development and Vercel previews working.
 */
export async function authEmailOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const headerStore = await headers();
  const host = (
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    ""
  )
    .split(",")[0]
    ?.trim();

  if (!host || /[\s/\\]/.test(host)) {
    throw new Error("Cannot determine the application origin for auth email.");
  }

  const forwardedProto = headerStore
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";

  return `${protocol}://${host}`;
}
