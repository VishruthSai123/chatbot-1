import "server-only";

import { removeImageBackground } from "@/lib/image/background-removal";
import {
  compressImage,
  convertImage,
  cropImage,
  getImageMetadata,
  getSharp,
  resizePhysicalImage,
  rotateImage,
} from "@/lib/image/native";
import { activeImageRegistry } from "@/lib/image/session-registry";
import { downloadArtifact } from "@/lib/storage";
import type {
  CompressInput,
  ConvertInput,
  CropInput,
  ImageOperationResult,
  RemoveBgInput,
  ResizePhysicalInput,
  RotateInput,
} from "./types";

export type ImageFallbackContext = {
  documentId?: string;
  chatId?: string;
  userId?: string;
};

/**
 * Extracts a Supabase storage key from an artifact URL, path, or signed URL.
 */
export function extractStorageKey(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== "string") {
    return null;
  }

  // 1. Matches: /object/(sign|public|authenticated)/artifacts/<key>?...
  const objectMatch = urlOrPath.match(
    /\/object\/(?:sign|public|authenticated)\/artifacts\/([^?#]+)/i
  );
  if (objectMatch?.[1]) {
    try {
      return decodeURIComponent(objectMatch[1]);
    } catch {
      return objectMatch[1];
    }
  }

  // 2. Matches: .../artifacts/<key>?... or artifacts/<key>
  const match = urlOrPath.match(/(?:^|\/)artifacts\/([^?#]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  // 3. Matches direct storage key pattern: <uuid-or-id>/<subfolder>/<timestamp>-<filename>
  const directKeyMatch = urlOrPath.match(
    /^([0-9a-fA-F-]{8,36}\/[^/?#]+\/[^?#]+)$/
  );
  if (directKeyMatch?.[1]) {
    try {
      return decodeURIComponent(directKeyMatch[1]);
    } catch {
      return directKeyMatch[1];
    }
  }

  return null;
}

function inferMimeType(filenameOrExt: string): string {
  const [withoutQuery] = filenameOrExt.toLowerCase().split("?");
  const [clean = ""] = (withoutQuery ?? "").split("#");
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (clean.endsWith(".png")) {
    return "image/png";
  }
  if (clean.endsWith(".webp")) {
    return "image/webp";
  }
  if (clean.endsWith(".gif")) {
    return "image/gif";
  }
  if (clean.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (clean.endsWith(".avif")) {
    return "image/avif";
  }
  return "image/png";
}

/**
 * Parses an image source (HTTP URL, Supabase signed URL, data URL, raw base64, or Buffer) into a Node Buffer,
 * with automatic fallback to session memory registry if remote fetch or URL is invalid.
 */
export async function parseImageInput(
  source: string | Buffer | null | undefined,
  fallbackContext?: ImageFallbackContext
): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (Buffer.isBuffer(source)) {
    return { buffer: source, mimeType: "image/png" };
  }

  // Helper to recover from active image session registry
  const tryFallback = (): { buffer: Buffer; mimeType: string } | null => {
    if (!fallbackContext) {
      return null;
    }
    const cached = activeImageRegistry.getActiveImage(fallbackContext);
    if (cached?.base64) {
      return {
        buffer: Buffer.from(cached.base64, "base64"),
        mimeType: cached.mimeType || "image/png",
      };
    }
    return null;
  };

  if (!source || typeof source !== "string" || !source.trim()) {
    const recovered = tryFallback();
    if (recovered) {
      return recovered;
    }
    throw new Error("Invalid or empty image source provided.");
  }

  const trimmed = source.trim();

  // 1. Check if source is a Document UUID directly
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    const cachedByDocId = activeImageRegistry.getActiveImage({
      documentId: trimmed,
    });
    if (cachedByDocId?.base64) {
      return {
        buffer: Buffer.from(cachedByDocId.base64, "base64"),
        mimeType: cachedByDocId.mimeType || "image/png",
      };
    }
  }

  // 2. Guard against hallucinated internal AI model reference URLs (e.g. Gemini internal content references)
  if (
    trimmed.includes("gemini.google.com") ||
    trimmed.includes("/api/content/references/") ||
    trimmed.includes("generativelanguage.googleapis.com")
  ) {
    const recovered = tryFallback();
    if (recovered) {
      return recovered;
    }
    throw new Error(
      "Invalid image source: received internal AI model reference URL instead of actual image data."
    );
  }

  // 3. Check data URLs
  const dataUrlMatch = trimmed.match(/^data:([^;]+).*?;base64,\s*([\s\S]+)$/i);
  if (dataUrlMatch) {
    const [, mimeType, base64Data] = dataUrlMatch;
    const cleanBase64 = base64Data.replace(/\s+/g, "");
    return {
      buffer: Buffer.from(cleanBase64, "base64"),
      mimeType: mimeType || "image/png",
    };
  }

  // 4. If it's a Supabase storage artifact (signed URL, public URL, or key), download directly via admin client
  const storageKey = extractStorageKey(trimmed);
  if (storageKey) {
    try {
      const buffer = await downloadArtifact(storageKey);
      return {
        buffer,
        mimeType: inferMimeType(storageKey),
      };
    } catch (storageErr: any) {
      console.warn(
        `Direct storage download for key "${storageKey}" failed, checking fallbacks:`,
        storageErr?.message || storageErr
      );
      const recovered = tryFallback();
      if (recovered) {
        return recovered;
      }
    }
  }

  // 5. Handle remote HTTP/HTTPS or relative URLs
  let fetchUrl = trimmed;
  if (fetchUrl.startsWith("/")) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (supabaseUrl && fetchUrl.startsWith("/storage/")) {
      fetchUrl = new URL(fetchUrl, supabaseUrl).toString();
    } else {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_PATH
        ? `http://localhost:${process.env.PORT || 3000}${process.env.NEXT_PUBLIC_BASE_PATH}`
        : `http://localhost:${process.env.PORT || 3000}`;
      fetchUrl = new URL(fetchUrl, baseUrl).toString();
    }
  }

  if (fetchUrl.startsWith("http://") || fetchUrl.startsWith("https://")) {
    try {
      let validUrl = fetchUrl;
      try {
        validUrl = new URL(fetchUrl).toString();
      } catch {
        validUrl = encodeURI(fetchUrl);
      }

      const response = await fetch(validUrl, {
        headers: {
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SuperiorAI/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        // Attempt recovery before throwing
        const recovered = tryFallback();
        if (recovered) {
          console.warn(
            `Remote image fetch failed with HTTP ${response.status} for ${validUrl}, recovered using active session image.`
          );
          return recovered;
        }

        throw new Error(
          `Failed to fetch remote image: HTTP ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType =
        response.headers.get("content-type") || inferMimeType(validUrl);
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType,
      };
    } catch (err: any) {
      const recovered = tryFallback();
      if (recovered) {
        console.warn(
          `Image fetch error (${err.message}), recovered using active session image.`
        );
        return recovered;
      }

      throw new Error(`Unable to fetch image from URL: ${err.message || err}`, {
        cause: err,
      });
    }
  }

  // 6. Treat as plain base64 string
  const cleanBase64 = trimmed.replace(/\s+/g, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.length === 0) {
    const recovered = tryFallback();
    if (recovered) {
      return recovered;
    }
    throw new Error("Invalid or empty image data provided.");
  }

  return {
    buffer,
    mimeType: "image/png",
  };
}

/**
 * Formats a Buffer result into ImageOperationResult.
 */
function formatResult(
  buffer: Buffer,
  width: number,
  height: number,
  format: string,
  density?: number
): ImageOperationResult {
  const base64 = buffer.toString("base64");
  const mimeType =
    format === "jpeg" || format === "jpg" ? "image/jpeg" : `image/${format}`;
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    base64,
    dataUrl,
    density,
    format,
    height,
    sizeBytes: buffer.length,
    width,
  };
}

/**
 * Execute physical resizing with DPI injection.
 */
export async function executeResizePhysical(
  input: string | Buffer,
  params: ResizePhysicalInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await resizePhysicalImage({
    dpi: params.dpi,
    fit: params.fit,
    format: params.format,
    height: params.height,
    inputBuffer: buffer,
    quality: params.quality,
    unit: params.unit,
    width: params.width,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format,
    result.density
  );
}

/**
 * Execute native background removal with transparent alpha or solid color backfill.
 */
export async function executeRemoveBg(
  input: string | Buffer,
  params: RemoveBgInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);

  // 1. Run neural segmentation to extract transparent foreground
  const bgResult = await removeImageBackground(buffer);

  if (params.mode === "solid_color" && params.color) {
    const sharp = await getSharp();
    // Composite transparent foreground over solid color background
    const compositeBuffer = await sharp({
      create: {
        background: params.color,
        channels: 4,
        height: bgResult.height,
        width: bgResult.width,
      },
    })
      .composite([{ blend: "over", input: bgResult.buffer }])
      .toFormat(params.format === "png" ? "png" : "jpeg", {
        quality: params.quality ?? 95,
      })
      .toBuffer();

    const meta = await sharp(compositeBuffer).metadata();
    return formatResult(
      compositeBuffer,
      meta.width ?? bgResult.width,
      meta.height ?? bgResult.height,
      meta.format ?? params.format ?? "jpeg",
      meta.density
    );
  }

  // Transparent output (always PNG)
  return formatResult(bgResult.buffer, bgResult.width, bgResult.height, "png");
}

/**
 * Execute cropping of bounding box.
 */
export async function executeCrop(
  input: string | Buffer,
  params: CropInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await cropImage({
    format: params.format ?? "jpeg",
    height: params.height,
    inputBuffer: buffer,
    left: params.left,
    quality: params.quality ?? 95,
    top: params.top,
    width: params.width,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Execute rotation and flip.
 */
export async function executeRotate(
  input: string | Buffer,
  params: RotateInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await rotateImage({
    degrees: params.degrees ?? 0,
    flipHorizontal: params.flipHorizontal ?? false,
    flipVertical: params.flipVertical ?? false,
    format: params.format ?? "jpeg",
    inputBuffer: buffer,
    quality: params.quality ?? 95,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Execute compression targeting quality or byte bound.
 */
export async function executeCompress(
  input: string | Buffer,
  params: CompressInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await compressImage({
    format: params.format ?? "jpeg",
    inputBuffer: buffer,
    quality: params.quality ?? 80,
    targetSizeKb: params.targetSizeKb,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Execute format conversion.
 */
export async function executeConvert(
  input: string | Buffer,
  params: ConvertInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await convertImage({
    inputBuffer: buffer,
    quality: params.quality,
    targetFormat: params.targetFormat,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Extract image metadata.
 */
export async function executeGetMetadata(
  input: string | Buffer,
  fallbackContext?: ImageFallbackContext
) {
  const { buffer } = await parseImageInput(input, fallbackContext);
  return getImageMetadata(buffer);
}
