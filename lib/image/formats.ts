/**
 * Format capabilities, shared by the native pipeline, the API route and the
 * studio inspectors.
 *
 * Dependency-free (no Node APIs, no DOM) so the browser bundle and the unit tests
 * can both import it, and so the rule lives in exactly one place: an encoder that
 * cannot store an alpha channel must never be allowed to silently reinstate a
 * background the user just removed.
 */

import type { ImageFormat } from "@/lib/image/native";

/**
 * Whether an encoder can store an alpha channel. JPEG is the only format the
 * tools offer without one.
 */
export function formatSupportsAlpha(format: string): boolean {
  return format !== "jpeg" && format !== "jpg";
}

/** Background a transparent area becomes when a user confirms flattening. */
export const FLATTEN_BACKGROUND = "#ffffff";

export type AlphaFormatResolution = {
  /**
   * Colour to flatten a transparent source onto. Only set when the user has
   * confirmed losing transparency — otherwise the encoder is switched instead.
   */
  flattenBackground?: string;
  format: ImageFormat;
};

/**
 * Decides which encoder an operation actually writes.
 *
 * `requested` is a preference, not a promise: when the source has an alpha
 * channel and the request is for a format without one, transparency wins and the
 * output becomes a PNG. Passing `flattenAlpha` (the user answered the studio's
 * confirmation) flattens onto {@link FLATTEN_BACKGROUND} instead, which keeps the
 * cutout composition but is deliberately opaque.
 */
export function resolveAlphaFormat({
  flattenAlpha = false,
  hasAlpha,
  requested,
}: {
  flattenAlpha?: boolean;
  hasAlpha: boolean;
  requested: ImageFormat;
}): AlphaFormatResolution {
  if (!hasAlpha || formatSupportsAlpha(requested)) {
    return { format: requested };
  }

  return flattenAlpha
    ? { flattenBackground: FLATTEN_BACKGROUND, format: requested }
    : { format: "png" };
}
