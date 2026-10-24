import "server-only";

import {
  deleteMediaSession,
  getMediaSession,
  getMediaSessionPlatforms,
  saveMediaSession,
} from "@/lib/db/queries";
import {
  cookieSecret,
  decryptSecret,
  encryptSecret,
} from "@/lib/media/cookie-crypto";
import {
  type CookieSummary,
  isCookieFile,
  MAX_COOKIE_FILE_BYTES,
  primaryDomain,
  summariseCookieFile,
} from "@/lib/media/cookie-file";

/*
 * The user's own session for a media platform.
 *
 * Instagram and Facebook serve most of their content only to a signed-in
 * visitor. Rather than pretending otherwise, the app can hold the user's own
 * cookies — the file a browser extension exports — and use them for that
 * user's downloads.
 *
 * The rules that keep this safe:
 *
 * - The cookies are encrypted before they are stored.
 * - They are only ever read for the user who stored them.
 * - They are never logged, never returned to the browser, and never given to
 *   the model.
 * - They are used for that user's own downloads and nothing else.
 */

/** The platforms a session can be stored for. */
export const SESSION_PLATFORMS = ["facebook", "instagram"] as const;

export type SessionPlatform = (typeof SESSION_PLATFORMS)[number];

/** Whether a platform name is one a session can be stored for. */
export function isSessionPlatform(value: string): value is SessionPlatform {
  return (SESSION_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Stores the user's cookies for a platform.
 *
 * The file is checked before it is stored: a file that is not a cookie file, or
 * one that is implausibly large, is refused with an explanation rather than
 * being saved to be discovered later.
 */
export async function storeMediaSession({
  cookies,
  platform,
  userId,
}: {
  cookies: string;
  platform: string;
  userId: string;
}): Promise<CookieSummary> {
  if (!isSessionPlatform(platform)) {
    throw new Error(
      `A session can only be stored for ${SESSION_PLATFORMS.join(" or ")}.`
    );
  }

  const text = cookies.trim();

  if (!text) {
    throw new Error("No cookies were given.");
  }

  if (Buffer.byteLength(text, "utf8") > MAX_COOKIE_FILE_BYTES) {
    throw new Error("That cookie file is too large to be a session.");
  }

  if (!isCookieFile(text)) {
    throw new Error(
      "That does not look like a cookies.txt file. Export it from your browser as a Netscape-format cookie file."
    );
  }

  const summary = summariseCookieFile(text);

  await saveMediaSession({
    cookies: encryptSecret(text, cookieSecret()),
    platform,
    userId,
  });

  return summary;
}

/**
 * The user's cookies for a platform, in the clear, for the downloader.
 *
 * Returns nothing when the user has no session for that platform, which is the
 * common case: most platforms do not need one.
 */
export async function readMediaSession({
  platform,
  userId,
}: {
  platform: string;
  userId: string;
}): Promise<string | undefined> {
  const row = await getMediaSession({ platform, userId });

  if (!row) {
    return;
  }

  try {
    return decryptSecret(row.cookies, cookieSecret());
  } catch (error) {
    // The secret was rotated, or the row was tampered with. Either way the
    // session cannot be used, and saying so is better than downloading with a
    // broken session and reporting a confusing platform error.
    console.warn("The stored media session could not be read:", error);
  }
}

/**
 * The user's cookies for whichever platform a link belongs to.
 */
export async function readMediaSessionForUrl({
  url,
  userId,
}: {
  url: string;
  userId: string;
}): Promise<string | undefined> {
  const { detectPlatform } = await import("@/lib/media/url");
  const platform = detectPlatform(url);

  if (!isSessionPlatform(platform)) {
    return;
  }

  return await readMediaSession({ platform, userId });
}

/**
 * The platforms the user has a session for.
 */
export async function listMediaSessions({
  userId,
}: {
  userId: string;
}): Promise<string[]> {
  const platforms = await getMediaSessionPlatforms({ userId });

  return platforms.filter(isSessionPlatform);
}

/**
 * Forgets the user's session for a platform.
 */
export async function clearMediaSession({
  platform,
  userId,
}: {
  platform: string;
  userId: string;
}): Promise<void> {
  if (!isSessionPlatform(platform)) {
    throw new Error(
      `A session can only be stored for ${SESSION_PLATFORMS.join(" or ")}.`
    );
  }

  await deleteMediaSession({ platform, userId });
}

/**
 * The domain a stored session belongs to, for showing the user what they
 * connected.
 */
export function sessionDomain(cookies: string): string | undefined {
  return primaryDomain(cookies);
}
