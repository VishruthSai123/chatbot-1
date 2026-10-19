/**
 * Recognising raw base64 image data, and guessing its real format from the
 * decoded bytes.
 *
 * This exists because guessing from the *string* is not safe: base64 for a JPEG
 * always begins `"/9j/…"`, so a leading `/` looks exactly like a root-relative
 * URL. Anything that treats a leading slash as a path will misroute JPEG base64,
 * and the failure is silent — the image tools recover "gracefully" using
 * whichever image happened to be newest, so an edit aimed at an older version
 * quietly lands on the head instead. Decoding the first bytes and checking for a
 * real image signature is the only reliable test.
 */

import { sniffImageBytes } from "@/lib/image/signatures";

const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;

/**
 * The byte rules live in {@link sniffImageBytes} because the browser needs the
 * same answers (to pick a mime type for a preview or a download) and cannot use
 * Buffer. This stays as the server-facing name.
 */
export function sniffImageMime(buffer: Buffer | Uint8Array): string | null {
  return sniffImageBytes(buffer);
}

/**
 * Decode a string that is *entirely* base64 and whose decoded head is a real
 * image. Returns null for anything URL-shaped (which always contains characters
 * outside the base64 alphabet) or for non-image data.
 */
export function decodeBase64Image(
  source: string
): { buffer: Buffer; mimeType: string } | null {
  const cleaned = source.replace(/\s+/g, "");

  // Too short to be an image, or not base64 at all (e.g. a URL has `:` or `.`).
  if (cleaned.length < 64 || cleaned.length % 4 !== 0) {
    return null;
  }
  if (!BASE64_ONLY.test(cleaned)) {
    return null;
  }

  const mimeType = sniffImageMime(Buffer.from(cleaned.slice(0, 64), "base64"));
  if (!mimeType) {
    return null;
  }

  const buffer = Buffer.from(cleaned, "base64");

  return buffer.length > 0 ? { buffer, mimeType } : null;
}
