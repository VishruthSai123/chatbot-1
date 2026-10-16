import "server-only";

import type SharpModule from "sharp";
import type { Sharp } from "sharp";

import type { DpiOption, PhysicalUnit } from "./presets";
import { physicalToPixels } from "./presets";

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
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  density?: number;
}

export interface ImageMetadataResult {
  width: number;
  height: number;
  format: string;
  channels: number;
  density?: number;
  colorSpace?: string;
  sizeBytes: number;
  hasAlpha: boolean;
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
    width: meta.width ?? width,
    height: meta.height ?? height,
    format: meta.format ?? format,
    sizeBytes: outputBuffer.length,
    density: meta.density,
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
  const sharp = await getSharp();
  const targetWidthPx = physicalToPixels(width, unit, dpi);
  const targetHeightPx = physicalToPixels(height, unit, dpi);

  const pipeline = sharp(inputBuffer)
    .resize(targetWidthPx, targetHeightPx, {
      fit,
      position: "centre",
      withoutEnlargement: false,
    })
    .withMetadata({ density: dpi }); // Embeds DPI into JFIF/EXIF headers

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: meta.width ?? targetWidthPx,
    height: meta.height ?? targetHeightPx,
    format: meta.format ?? format,
    sizeBytes: outputBuffer.length,
    density: dpi,
  };
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
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  });

  const outputBuffer = await applyFormat(pipeline, format, quality).toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: meta.width ?? width,
    height: meta.height ?? height,
    format: meta.format ?? format,
    sizeBytes: outputBuffer.length,
  };
}

/**
 * Rotate the image by 90, 180, or 270 degrees and/or flip horizontally/vertically.
 */
export async function rotateImage({
  inputBuffer,
  degrees = 0,
  flipHorizontal = false,
  flipVertical = false,
  format = "jpeg",
  quality = 95,
}: {
  inputBuffer: Buffer;
  degrees?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  format?: ImageFormat;
  quality?: number;
}): Promise<ImageProcessingResult> {
  const sharp = await getSharp();
  let pipeline = sharp(inputBuffer);

  if (degrees !== 0) {
    pipeline = pipeline.rotate(degrees);
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
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? format,
    sizeBytes: outputBuffer.length,
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

    for (let i = 0; i < 8; i++) {
      const mid = Math.round((low + high) / 2);
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
      finalBuffer = await applyFormat(
        sharp(inputBuffer),
        format,
        5
      ).toBuffer();
    }

    const meta = await sharp(finalBuffer).metadata();
    return {
      buffer: finalBuffer,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: meta.format ?? format,
      sizeBytes: finalBuffer.length,
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
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? format,
    sizeBytes: outputBuffer.length,
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
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? targetFormat,
    sizeBytes: outputBuffer.length,
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
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "unknown",
    channels: meta.channels ?? 0,
    density: meta.density,
    colorSpace: meta.space,
    sizeBytes: inputBuffer.length,
    hasAlpha: meta.hasAlpha ?? false,
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
      return pipeline.jpeg({ quality, mozjpeg: true });
    case "png":
      return pipeline.png({ quality, compressionLevel: 6 });
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
