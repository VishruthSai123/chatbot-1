/**
 * Image rules shared by chat attachments and OCR.
 *
 * Kept free of `server-only` and native image libraries so it can be tested
 * without booting the app. The conversion itself lives in `vision.ts`.
 */

export const GEMINI_IMAGE_MEDIA_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** A single image part larger than this is downscaled before upload. */
export const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

export function isGeminiImageType(mediaType: string): boolean {
  return GEMINI_IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase().split(";")[0]);
}

/** Bytes win over the declared type: an upload named `.png` may be a JPEG. */
export function sniffImageMediaType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 6 &&
    buffer.subarray(0, 4).toString("ascii") === "GIF8"
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") {
      return "image/avif";
    }
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "hevc" ||
      brand === "hevx" ||
      brand === "mif1" ||
      brand === "msf1"
    ) {
      return "image/heic";
    }
  }

  const head = buffer
    .subarray(0, 256)
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  if (
    head.startsWith("<svg") ||
    (head.startsWith("<?xml") && head.includes("<svg"))
  ) {
    return "image/svg+xml";
  }

  return null;
}

export function resolveImageMediaType(
  buffer: Buffer,
  declared?: string
): string {
  const declaredType = (declared ?? "").toLowerCase().split(";")[0].trim();
  return sniffImageMediaType(buffer) ?? declaredType;
}
