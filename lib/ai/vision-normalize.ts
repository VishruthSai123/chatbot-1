import sharp from "sharp";

import {
  GEMINI_IMAGE_MEDIA_TYPES,
  MAX_VISION_IMAGE_BYTES,
  resolveImageMediaType,
} from "./vision-limits";

const MAX_VISION_DIMENSION = 2048;

export type VisionImage = {
  buffer: Buffer;
  mediaType: string;
};

/**
 * Validates and normalises an image for Gemini.
 *
 * The declared media type is only a hint: bytes win, because an upload named
 * `.png` is not always a PNG. Images over the inline budget or in a format
 * Gemini does not accept are re-encoded as a bounded JPEG.
 */
export async function normalizeVisionImage({
  buffer,
  mediaType,
}: {
  buffer: Buffer;
  mediaType?: string;
}): Promise<VisionImage> {
  if (!buffer.length) {
    throw new Error("The image is empty.");
  }

  const detected = resolveImageMediaType(buffer, mediaType);

  if (!detected.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }

  if (
    GEMINI_IMAGE_MEDIA_TYPES.has(detected) &&
    buffer.length <= MAX_VISION_IMAGE_BYTES
  ) {
    return { buffer, mediaType: detected };
  }

  try {
    const image = sharp(buffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const needsResize =
      (metadata.width ?? 0) > MAX_VISION_DIMENSION ||
      (metadata.height ?? 0) > MAX_VISION_DIMENSION;

    const resized = needsResize
      ? image.resize({
          fit: "inside",
          height: MAX_VISION_DIMENSION,
          width: MAX_VISION_DIMENSION,
          withoutEnlargement: true,
        })
      : image;

    const encoded = await resized
      .jpeg({ mozjpeg: true, quality: 85 })
      .toBuffer();

    if (encoded.length > MAX_VISION_IMAGE_BYTES) {
      const smaller = await sharp(encoded)
        .resize({
          fit: "inside",
          height: 1536,
          width: 1536,
          withoutEnlargement: true,
        })
        .jpeg({ mozjpeg: true, quality: 75 })
        .toBuffer();

      if (smaller.length > MAX_VISION_IMAGE_BYTES) {
        throw new Error("The image is too large to read. Try a smaller image.");
      }

      return { buffer: smaller, mediaType: "image/jpeg" };
    }

    return { buffer: encoded, mediaType: "image/jpeg" };
  } catch (error) {
    if (error instanceof Error && error.message.includes("too large")) {
      throw error;
    }
    throw new Error(
      "The image could not be decoded. Use a PNG, JPEG or WEBP image.",
      { cause: error }
    );
  }
}

/** A short, user-safe explanation for a failed vision request. */
export function visionErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.includes("Gemini is not configured")
  ) {
    return error.message;
  }

  const status =
    error && typeof error === "object"
      ? ((error as { statusCode?: number }).statusCode ??
        (error as { cause?: { statusCode?: number } }).cause?.statusCode)
      : undefined;

  if (status === 401 || status === 403) {
    return "Image recognition is not configured correctly. Check the Gemini API key.";
  }
  if (status === 402) {
    return "Image recognition is unavailable because the Gemini API has no remaining credits.";
  }
  if (status === 429) {
    return "Image recognition is temporarily rate-limited. Please retry in a moment.";
  }
  if (status === 404) {
    return "The configured vision model is not available.";
  }

  return "The image could not be read. Please retry with a clear PNG or JPEG.";
}
