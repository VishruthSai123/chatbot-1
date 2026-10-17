import "server-only";

import type SharpModule from "sharp";
import type { Sharp } from "sharp";

import {
  type DimensionSpec,
  parseAspectRatio,
  type ResolvedGeometry,
  resolveTargetGeometry,
} from "./dimensions";
import type { DpiOption, PhysicalUnit } from "./presets";

// Lazy-load Sharp to prevent cold-start crashes in serverless environments
let sharpInstance: typeof SharpModule | null = null;

export async function getSharp(): Promise<typeof SharpModule> {
  if (!sharpInstance) {
    const mod = await import("sharp");
    sharpInstance = (mod.default || mod) as unknown as typeof SharpModule;
    try {
      sharpInstance.concurrency(1);
    } catch {
      /* ignore */
    }
  }
  return sharpInstance;
}

/**
 * Supported output image formats.
 */
export type ImageFormat = "jpeg" | "png" | "webp" | "avif" | "tiff";

/**
 * Resize fit strategies matching Sharp's options.
 */
export type ResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface ImageProcessingResult {
  buffer: Buffer;
  density?: number;
  format: string;
  height: number;
  sizeBytes: number;
  width: number;
}

export interface ImageMetadataResult {
  channels: number;
  colorSpace?: string;
  density?: number;
  format: string;
  hasAlpha: boolean;
  height: number;
  sizeBytes: number;
  width: number;
}

// ─── Core Processing Functions ───────────────────────────────────────────────

/**
 * Resize an image to exact pixel dimensions.
 */
export async function resizeImage({
  inputBuffer,
  width,
  height,
  fit = "cover",
  maintainAspectRatio = true,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  width: number;
  height: number;
  fit?: ResizeFit;
  maintainAspectRatio?: boolean;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  const pipeline = sharp(inputBuffer).resize(width, height, {
    fit: maintainAspectRatio ? fit : "fill",
    position: "centre",
    withoutEnlargement: false,
  });

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    density: meta.density,
    format: meta.format ?? format,
    height: meta.height ?? height,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? width,
  };
}

/**
 * Resize an image to geometry resolved from a flexible {@link DimensionSpec}.
 *
 * This is the single resize entry point: exact pixels, physical units + DPI,
 * aspect ratio, relative scale, bounded fit, and named presets all funnel through
 * {@link resolveTargetGeometry}. An optional `targetSizeKb` bound is honoured by a
 * second compression pass so e.g. "35×45 mm under 50 KB" works in one call.
 */
export async function resizeToSpec({
  inputBuffer,
  spec,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  spec: DimensionSpec;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult & { geometry: ResolvedGeometry }> {
  const sharp = await getSharp();
  const meta = await sharp(inputBuffer).metadata();
  const geometry = resolveTargetGeometry(spec, {
    height: meta.height ?? 0,
    width: meta.width ?? 0,
  });

  // "pad" is our alias for letterboxing; sharp only knows "contain".
  const sharpFit = geometry.fit === "pad" ? "contain" : geometry.fit;
  const background =
    sharpFit === "contain"
      ? (geometry.padColor ?? (format === "jpeg" ? "#ffffff" : undefined))
      : undefined;

  let pipeline = sharp(inputBuffer).resize(geometry.width, geometry.height, {
    background,
    fit: sharpFit,
    position: "centre",
    withoutEnlargement: false,
  });

  if (geometry.dpi) {
    // Embeds DPI into JFIF/EXIF headers
    pipeline = pipeline.withMetadata({ density: geometry.dpi });
  }

  let outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();

  if (geometry.targetSizeKb) {
    const bounded = await compressImage({
      format,
      inputBuffer: outputBuffer,
      targetSizeKb: geometry.targetSizeKb,
    });
    outputBuffer = bounded.buffer;
  }

  const outMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    density: outMeta.density ?? geometry.dpi,
    format: outMeta.format ?? format,
    geometry,
    height: outMeta.height ?? geometry.height,
    sizeBytes: outputBuffer.length,
    width: outMeta.width ?? geometry.width,
  };
}

/**
 * Resize an image using physical dimensions (mm, cm, in) with DPI metadata embedding.
 *
 * The core formula: pixels = round((dimension_mm / 25.4) × DPI)
 * Output images have JFIF/EXIF density tags set to the target DPI.
 */
export async function resizePhysicalImage({
  inputBuffer,
  width,
  height,
  unit,
  dpi = 300,
  fit = "cover",
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  width: number;
  height: number;
  unit: PhysicalUnit;
  dpi?: DpiOption;
  fit?: ResizeFit;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const { geometry, ...result } = await resizeToSpec({
    format,
    inputBuffer,
    quality,
    spec: { dpi, fit, height, unit, width },
  });
  return { ...result, density: geometry.dpi };
}

/**
 * Crop a rectangular region from the image.
 */
export async function cropImage({
  inputBuffer,
  left,
  top,
  width,
  height,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  const pipeline = sharp(inputBuffer).extract({
    height: Math.round(height),
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
  });

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: meta.format ?? format,
    height: meta.height ?? height,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? width,
  };
}

/**
 * Crop the image to an exact aspect ratio without any upscaling.
 *
 * The output is the largest region of the source that matches `aspectRatio`,
 * anchored by `mode` ("center" | "top" | "bottom" | "attention" | "entropy").
 * "attention"/"entropy" let sharp pick the most "interesting" region, which is the
 * closest native equivalent to a smart/face-ish crop.
 */
export async function cropToAspect({
  inputBuffer,
  aspectRatio,
  mode = "center",
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  aspectRatio: string | number;
  mode?: "center" | "top" | "bottom" | "attention" | "entropy";
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const ratio = parseAspectRatio(aspectRatio);
  if (ratio === null) {
    throw new Error(`Invalid aspect ratio: ${aspectRatio}`);
  }

  const sharp = await getSharp();
  const meta = await sharp(inputBuffer).metadata();
  const srcWidth = Math.max(1, meta.width ?? 0);
  const srcHeight = Math.max(1, meta.height ?? 0);
  const srcRatio = srcWidth / srcHeight;

  // Largest box matching `ratio` that fits inside the source.
  let targetWidth = srcWidth;
  let targetHeight = srcHeight;
  if (ratio > srcRatio) {
    targetHeight = Math.max(1, Math.round(srcWidth / ratio));
  } else {
    targetWidth = Math.max(1, Math.round(srcHeight * ratio));
  }

  const position =
    mode === "top"
      ? "top"
      : mode === "bottom"
        ? "bottom"
        : mode === "attention"
          ? "attention"
          : mode === "entropy"
            ? "entropy"
            : "centre";

  const pipeline = sharp(inputBuffer).resize(targetWidth, targetHeight, {
    fit: "cover",
    position,
  });

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: outMeta.format ?? format,
    height: outMeta.height ?? targetHeight,
    sizeBytes: outputBuffer.length,
    width: outMeta.width ?? targetWidth,
  };
}

/**
 * Rotate the image by an arbitrary angle (degrees) and/or flip horizontally/vertically.
 * Blank corners created by non-90° rotations are filled with `background`.
 */
export async function rotateImage({
  inputBuffer,
  degrees = 0,
  flipHorizontal = false,
  flipVertical = false,
  background = "#ffffff",
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  degrees?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  background?: string;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  let pipeline = sharp(inputBuffer);

  if (degrees !== 0) {
    pipeline = pipeline.rotate(degrees, { background });
  }

  if (flipHorizontal) {
    pipeline = pipeline.flop();
  }

  if (flipVertical) {
    pipeline = pipeline.flip();
  }

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: meta.format ?? format,
    height: meta.height ?? 0,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? 0,
  };
}

/**
 * Compress an image to a target quality or approximate file size.
 *
 * When targetSizeKb is specified, uses an iterative binary-search approach
 * to find the quality setting that produces a file closest to the target
 * (within 10% tolerance).
 */
export async function compressImage({
  inputBuffer,
  targetSizeKb,
  quality = 80,
  format = "jpeg",
}: {
  inputBuffer: Buffer;
  targetSizeKb?: number;
  quality?: number;
  format?: ImageFormat;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();

  if (targetSizeKb) {
    // Iterative binary search for target file size
    const targetBytes = targetSizeKb * 1024;
    let low = 5;
    let high = 100;
    let bestBuffer: Buffer | null = null;

    for (let i = 0; i < 8; i += 1) {
      const mid = Math.round((low + high) / 2);
      // biome-ignore lint/performance/noAwaitInLoops: binary search requires sequential execution
      const testBuffer = await applyFormat(
        sharp(inputBuffer),
        format,
        mid
      ).toBuffer();

      if (testBuffer.length <= targetBytes) {
        bestBuffer = testBuffer;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let finalBuffer = bestBuffer;
    if (!finalBuffer) {
      // Even minimum quality exceeds target — return lowest quality output
      finalBuffer = await applyFormat(sharp(inputBuffer), format, 5).toBuffer();
    }

    const meta = await sharp(finalBuffer).metadata();
    return {
      buffer: finalBuffer,
      format: meta.format ?? format,
      height: meta.height ?? 0,
      sizeBytes: finalBuffer.length,
      width: meta.width ?? 0,
    };
  }

  // Direct quality compression
  const outputBuffer = await applyFormat(
    sharp(inputBuffer),
    format,
    quality
  ).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: meta.format ?? format,
    height: meta.height ?? 0,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? 0,
  };
}

/**
 * Convert an image to a different format.
 */
export async function convertImage({
  inputBuffer,
  targetFormat,
  quality = 95,
}: {
  inputBuffer: Buffer;
  targetFormat: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  const outputBuffer = await applyFormat(
    sharp(inputBuffer),
    targetFormat,
    quality
  ).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: meta.format ?? targetFormat,
    height: meta.height ?? 0,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? 0,
  };
}

/**
 * Upscale (super-sample) to a target size, arbitrary scale, or max long edge.
 *
 * Uses Lanczos3 resampling for high-quality enlargement, an optional unsharp mask
 * for edge clarity, and optional brightness/saturation modulation. Geometry is
 * resolved through {@link resolveTargetGeometry} so units/ratios stay consistent.
 */
export async function upscaleToTarget({
  inputBuffer,
  scale,
  targetWidth,
  targetHeight,
  maxLongEdge,
  sharpen = true,
  enhance = false,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  scale?: number;
  targetWidth?: number;
  targetHeight?: number;
  maxLongEdge?: number;
  sharpen?: boolean;
  enhance?: boolean;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  const meta = await sharp(inputBuffer).metadata();
  const srcWidth = Math.max(1, meta.width ?? 0);
  const srcHeight = Math.max(1, meta.height ?? 0);

  const hasExplicit =
    (targetWidth !== undefined && targetWidth > 0) ||
    (targetHeight !== undefined && targetHeight > 0) ||
    (maxLongEdge !== undefined && maxLongEdge > 0);

  const geometry = resolveTargetGeometry(
    {
      allowUpscale: true,
      fit: "fill",
      height: targetHeight,
      maxLongEdge,
      scalePercent:
        !hasExplicit && scale !== undefined && scale > 0
          ? scale * 100
          : undefined,
      width: targetWidth,
    },
    { height: srcHeight, width: srcWidth }
  );

  const outWidth = geometry.width;
  const outHeight = geometry.height;

  let pipeline = sharp(inputBuffer).resize(outWidth, outHeight, {
    fit: "fill",
    kernel: "lanczos3",
  });

  if (sharpen) {
    pipeline = pipeline.sharpen({ sigma: 1 });
  }
  if (enhance) {
    pipeline = pipeline.modulate({ brightness: 1.02, saturation: 1.05 });
  }

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: outMeta.format ?? format,
    height: outMeta.height ?? outHeight,
    sizeBytes: outputBuffer.length,
    width: outMeta.width ?? outWidth,
  };
}

/**
 * Upscale (super-sample) and/or enhance an image by a fixed multiplier.
 *
 * Uses Lanczos3 resampling for high-quality enlargement, an optional unsharp
 * mask for edge clarity, and optional brightness/saturation modulation.
 */
export function upscaleEnhanceImage({
  inputBuffer,
  scale = 2,
  sharpen = true,
  enhance = false,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  scale?: number;
  sharpen?: boolean;
  enhance?: boolean;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  return upscaleToTarget({
    enhance,
    format,
    inputBuffer,
    quality,
    scale,
    sharpen,
  });
}

/**
 * Pixelate (mosaic) or blur an image for privacy redaction.
 *
 * Mosaic mode downsamples to a fraction of the resolution with nearest-neighbour
 * sampling and scales back up for hard pixel blocks. Blur mode applies a Gaussian
 * blur sized to the block factor.
 */
export async function pixelateImage({
  inputBuffer,
  blockSize = 12,
  mode = "mosaic",
  format = "png",
  quality = 95,
}: {
  inputBuffer: Buffer;
  blockSize?: number;
  mode?: "mosaic" | "blur";
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  const meta = await sharp(inputBuffer).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  const factor = Math.max(2, Math.round(blockSize));

  const smallWidth = Math.max(1, Math.round(srcWidth / factor));
  const smallHeight = Math.max(1, Math.round(srcHeight / factor));

  let pipeline = sharp(inputBuffer).resize(smallWidth, smallHeight, {
    fit: "fill",
    kernel: "nearest",
  });

  if (mode === "blur") {
    pipeline = pipeline.blur(Math.max(1, factor / 3));
  }

  pipeline = pipeline.resize(srcWidth, srcHeight, {
    fit: "fill",
    kernel: "nearest",
  });

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: outMeta.format ?? format,
    height: outMeta.height ?? srcHeight,
    sizeBytes: outputBuffer.length,
    width: outMeta.width ?? srcWidth,
  };
}

/**
 * Extract comprehensive metadata from an image buffer.
 */
export async function getImageMetadata(
  inputBuffer: Buffer
): Promise<ImageMetadataResult> {
  const sharp = await getSharp();
  const meta = await sharp(inputBuffer).metadata();

  return {
    channels: meta.channels ?? 0,
    colorSpace: meta.space,
    density: meta.density,
    format: meta.format ?? "unknown",
    hasAlpha: meta.hasAlpha ?? false,
    height: meta.height ?? 0,
    sizeBytes: inputBuffer.length,
    width: meta.width ?? 0,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Apply output format and quality settings to a Sharp pipeline.
 */
function applyFormat(
  pipeline: Sharp,
  format: ImageFormat,
  quality: number
): Sharp {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ mozjpeg: true, quality });
    case "png":
      return pipeline.png({ compressionLevel: 6, quality });
    case "webp":
      return pipeline.webp({ quality });
    case "avif":
      return pipeline.avif({ quality });
    case "tiff":
      return pipeline.tiff({ quality });
    default:
      return pipeline.jpeg({ quality });
  }
}
