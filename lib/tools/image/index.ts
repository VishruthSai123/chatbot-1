import "server-only";

import { getDocumentById, getLatestDocumentByKind } from "@/lib/db/queries";
import {
  alphaBounds,
  decontaminate,
  expandBounds,
  hexToRgb,
  toAlphaFloats,
} from "@/lib/image/alpha";
import { segmentImage } from "@/lib/image/background-removal";
import { decodeBase64Image } from "@/lib/image/base64";
import {
  compressImage,
  convertImage,
  cropImage,
  cropToAspect,
  getImageMetadata,
  getSharp,
  type ImageFormat,
  pixelateImage,
  resizeToSpec,
  rotateImage,
  upscaleToTarget,
} from "@/lib/image/native";
import { extractTextFromImage } from "@/lib/image/ocr";
import { activeImageRegistry } from "@/lib/image/session-registry";
import { downloadArtifact } from "@/lib/storage";
import type {
  CompressInput,
  ConvertInput,
  CropInput,
  ImageOperationResult,
  OcrInput,
  OcrOperationResult,
  PixelateInput,
  RemoveBgInput,
  ResizeInput,
  RotateInput,
  UpscaleInput,
} from "./types";

export type ImageFallbackContext = {
  documentId?: string;
  chatId?: string;
  userId?: string;
};

/** Colour channels in the decoded base image a matte is joined onto. */
const RGB_CHANNELS = 3;

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

  /**
   * Last-resort durable recovery: pull the newest persisted image Document for the
   * user straight from Postgres. This is what makes image edits survive serverless
   * cold starts, new sessions, reloads and expiring signed URLs — none of which the
   * in-memory registry can cover.
   */
  const durableFallback = async (): Promise<{
    buffer: Buffer;
    mimeType: string;
  } | null> => {
    const userId = fallbackContext?.userId;
    if (!userId) {
      return tryFallback();
    }
    try {
      const latest = await getLatestDocumentByKind({ kind: "image", userId });
      if (latest?.content) {
        const buffer = Buffer.from(latest.content, "base64");
        if (buffer.length > 0) {
          activeImageRegistry.setActiveImage({
            base64: latest.content,
            chatId: fallbackContext?.chatId,
            documentId: latest.id,
            title: latest.title,
            userId,
          });
          return { buffer, mimeType: "image/png" };
        }
      }
    } catch (err) {
      console.warn("Non-fatal: durable image fallback query failed:", err);
    }
    return tryFallback();
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

    // Cold in-memory cache (e.g. after a server restart / browser reload):
    // resolve the document UUID straight from Postgres before giving up.
    try {
      const doc = await getDocumentById({ id: trimmed });
      if (doc?.content) {
        const buffer = Buffer.from(doc.content, "base64");
        if (buffer.length > 0) {
          activeImageRegistry.setActiveImage({
            base64: doc.content,
            documentId: doc.id,
            title: doc.title,
            userId: fallbackContext?.userId,
          });
          return { buffer, mimeType: "image/png" };
        }
      }
    } catch (docErr) {
      console.warn("Non-fatal: Document lookup for image UUID failed:", docErr);
    }
  }

  // 2. Guard against hallucinated internal AI model reference URLs (e.g. Gemini internal content references)
  const lowerSource = trimmed.toLowerCase();
  if (
    lowerSource.includes("gemini.google.com") ||
    lowerSource.includes("/api/content/references") ||
    lowerSource.includes("generativelanguage.googleapis.com") ||
    lowerSource.includes("googleusercontent.com") ||
    lowerSource.includes("googleapis.com") ||
    lowerSource.startsWith("blob:")
  ) {
    const recovered = await durableFallback();
    if (recovered) {
      return recovered;
    }
    throw new Error(
      "Invalid image source: received an internal AI model reference URL instead of actual image data."
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
      const recovered = await durableFallback();
      if (recovered) {
        return recovered;
      }
    }
  }

  // 4b. Raw base64 image data.
  //
  // This must run *before* the URL handling below. Base64 for a JPEG always
  // starts `"/9j/…"`, so the leading slash would otherwise be read as a
  // root-relative path, rewritten to `http://localhost:…/9j/…`, fail to fetch,
  // and silently recover using whichever image was newest — turning "edit the
  // version I am looking at" into "edit the head".
  const decoded = decodeBase64Image(trimmed);
  if (decoded) {
    return decoded;
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
        const recovered = await durableFallback();
        if (recovered) {
          console.warn(
            `Remote image fetch failed with HTTP ${response.status} for ${validUrl}, recovered using persisted image.`
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
      const recovered = await durableFallback();
      if (recovered) {
        console.warn(
          `Image fetch error (${err.message}), recovered using persisted image.`
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
    const recovered = await durableFallback();
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

/** Fraction of the subject's size kept as breathing room when auto-cropping. */
const TRIM_PADDING_RATIO = 0.02;
/** Alpha below this counts as background when measuring the subject. */
const TRIM_ALPHA_THRESHOLD = 0.02;

/**
 * Bounding box of the subject, padded so a cutout is never flush with the frame.
 * Returns `null` when the matte is empty (nothing to keep).
 */
function trimBounds(
  alpha: Buffer,
  width: number,
  height: number
): { height: number; left: number; top: number; width: number } | null {
  const bounds = alphaBounds(
    toAlphaFloats(alpha),
    width,
    height,
    TRIM_ALPHA_THRESHOLD
  );
  if (!bounds) {
    return null;
  }

  const subject = Math.max(
    bounds.right - bounds.left + 1,
    bounds.bottom - bounds.top + 1
  );
  const padded = expandBounds(
    bounds,
    Math.max(2, Math.round(subject * TRIM_PADDING_RATIO)),
    width,
    height
  );

  return {
    height: padded.bottom - padded.top + 1,
    left: padded.left,
    top: padded.top,
    width: padded.right - padded.left + 1,
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
 * Execute a resize from a flexible dimension spec (exact px, physical units + DPI,
 * aspect ratio, relative scale, bounded fit, presets, and optional size bound).
 */
export async function executeResize(
  input: string | Buffer,
  params: ResizeInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await resizeToSpec({
    format: params.format ?? "jpeg",
    inputBuffer: buffer,
    quality: params.quality ?? 95,
    spec: {
      allowUpscale: params.allowUpscale,
      aspectRatio: params.aspectRatio,
      dpi: params.dpi,
      fit: params.fit,
      height: params.height,
      maxHeight: params.maxHeight,
      maxLongEdge: params.maxLongEdge,
      maxWidth: params.maxWidth,
      minHeight: params.minHeight,
      minWidth: params.minWidth,
      padColor: params.padColor,
      preset: params.preset,
      scalePercent: params.scalePercent,
      targetSizeKb: params.targetSizeKb,
      unit: params.unit,
      width: params.width,
    },
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
 * Execute native background removal.
 *
 * The matte is predicted on-device, edge-refined, then either kept as a
 * transparent PNG or composited onto a solid colour. Semi-transparent edge pixels
 * are colour-decontaminated first, which is what stops hair from picking up a
 * bright or dark fringe around the subject.
 */
export async function executeRemoveBg(
  input: string | Buffer,
  params: RemoveBgInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const sharp = await getSharp();
  const color = params.color ?? "#ffffff";
  const mode = params.mode ?? "transparent";
  const quality = params.quality ?? 95;

  const matte = await segmentImage(buffer, {
    edgeSmoothing: params.edgeSmoothing,
  });
  const { alpha, height, source, width } = matte;
  const solid = mode === "solid_color";
  const format: ImageFormat = solid ? (params.format ?? "jpeg") : "png";

  // Semi-transparent pixels still carry the old background colour, which shows up
  // as a fringe once the cutout sits on the new one. Solving
  // `observed = foreground * alpha + fill * (1 - alpha)` for the foreground
  // removes it before compositing.
  //
  // The base image is decoded to an explicit three-channel raw buffer: joining the
  // matte onto a *decoded* sharp pipeline (`.removeAlpha().joinChannel(...)`) drops
  // the matte again, because `removeAlpha` strips the last band after the join, and
  // the result is a fully opaque image that looks plausible enough to ship.
  const rgb = await sharp(source)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  if (rgb.length !== width * height * RGB_CHANNELS) {
    throw new Error(
      `Expected ${width * height * RGB_CHANNELS} colour bytes for the cutout, got ${rgb.length}.`
    );
  }

  const pixels = solid
    ? decontaminate(rgb, toAlphaFloats(alpha), width, height, hexToRgb(color))
    : rgb;
  // sharp applies `joinChannel` at the very end of its pipeline, so anything
  // chained after it — including `extract` and `flatten` — is silently ignored (the
  // uncropped, unflattened frame comes back with no error). Compose to raw first,
  // then crop and flatten in a second pipeline.
  const { data: composed, info } = await sharp(pixels, {
    raw: { channels: RGB_CHANNELS, height, width },
  })
    .joinChannel(alpha, { raw: { channels: 1, height, width } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const crop = params.autoTrim ? trimBounds(alpha, width, height) : null;
  let output = sharp(composed, {
    raw: { channels: info.channels, height, width },
  });
  // Flattening is only meaningful for a solid fill: it drops the matte the cutout
  // was decontaminated against, so semi-transparent edges cannot show through.
  if (solid) {
    output = output.flatten({ background: color });
  }
  if (crop) {
    output = output.extract(crop);
  }
  const outputBuffer = await output.toFormat(format, { quality }).toBuffer();

  const meta = await sharp(outputBuffer).metadata();
  if (!solid && !meta.hasAlpha) {
    throw new Error(
      "The background was removed but the transparent cutout lost its alpha channel."
    );
  }
  return formatResult(
    outputBuffer,
    meta.width ?? width,
    meta.height ?? height,
    meta.format ?? format,
    meta.density
  );
}

/**
 * Execute cropping — either to an aspect ratio (with an anchor mode) or to an
 * explicit pixel box.
 */
export async function executeCrop(
  input: string | Buffer,
  params: CropInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const format = params.format ?? "jpeg";
  const quality = params.quality ?? 95;

  let result: Awaited<ReturnType<typeof cropImage>>;
  if (params.aspectRatio) {
    result = await cropToAspect({
      aspectRatio: params.aspectRatio,
      format,
      inputBuffer: buffer,
      mode: params.mode ?? "center",
      quality,
    });
  } else {
    const { height = 0, left = 0, top = 0, width = 0 } = params;
    result = await cropImage({
      format,
      height,
      inputBuffer: buffer,
      left,
      quality,
      top,
      width,
    });
  }

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
    background: params.background ?? "#ffffff",
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
 * Execute upscaling and/or enhancement to a multiplier or an explicit target size.
 */
export async function executeUpscaleEnhance(
  input: string | Buffer,
  params: UpscaleInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await upscaleToTarget({
    enhance: params.enhance,
    format: params.format,
    inputBuffer: buffer,
    maxLongEdge: params.maxLongEdge,
    quality: params.quality,
    scale: params.scale,
    sharpen: params.sharpen,
    targetHeight: params.targetHeight,
    targetWidth: params.targetWidth,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Execute pixelation (mosaic) or blur for privacy redaction.
 */
export async function executePixelate(
  input: string | Buffer,
  params: PixelateInput,
  fallbackContext?: ImageFallbackContext
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input, fallbackContext);
  const result = await pixelateImage({
    blockSize: params.blockSize,
    format: params.format,
    inputBuffer: buffer,
    mode: params.mode,
    quality: params.quality,
  });

  return formatResult(
    result.buffer,
    result.width,
    result.height,
    result.format
  );
}

/**
 * Execute OCR text extraction via the native multimodal vision pipeline.
 */
export async function executeOcr(
  input: string | Buffer,
  _params: OcrInput,
  fallbackContext?: ImageFallbackContext
): Promise<OcrOperationResult> {
  const { buffer, mimeType } = await parseImageInput(input, fallbackContext);
  return extractTextFromImage(buffer, mimeType);
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
