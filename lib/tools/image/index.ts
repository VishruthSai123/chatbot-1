import "server-only";

import sharp from "sharp";
import { removeImageBackground } from "@/lib/image/background-removal";
import {
  compressImage,
  convertImage,
  cropImage,
  getImageMetadata,
  resizeImage,
  resizePhysicalImage,
  rotateImage,
} from "@/lib/image/native";
import type {
  CompressInput,
  ConvertInput,
  CropInput,
  ImageOperationResult,
  RemoveBgInput,
  ResizePhysicalInput,
  RotateInput,
} from "./types";

/**
 * Parses an image source (data URL, raw base64, or Buffer) into a Node Buffer.
 */
export function parseImageInput(source: string | Buffer): {
  buffer: Buffer;
  mimeType: string;
} {
  if (Buffer.isBuffer(source)) {
    return { buffer: source, mimeType: "image/png" };
  }

  const match = source.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    const mimeType = match[1];
    const base64Data = match[2];
    return {
      buffer: Buffer.from(base64Data, "base64"),
      mimeType,
    };
  }

  // Treat as plain base64
  return {
    buffer: Buffer.from(source, "base64"),
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
  const mimeType = format === "jpeg" || format === "jpg" ? "image/jpeg" : `image/${format}`;
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    base64,
    dataUrl,
    width,
    height,
    format,
    sizeBytes: buffer.length,
    density,
  };
}

/**
 * Execute physical resizing with DPI injection.
 */
export async function executeResizePhysical(
  input: string | Buffer,
  params: ResizePhysicalInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);
  const result = await resizePhysicalImage({
    inputBuffer: buffer,
    width: params.width,
    height: params.height,
    unit: params.unit,
    dpi: params.dpi,
    fit: params.fit,
    format: params.format,
    quality: params.quality,
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
  params: RemoveBgInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);

  // 1. Run neural segmentation to extract transparent foreground
  const bgResult = await removeImageBackground(buffer);

  if (params.mode === "solid_color" && params.color) {
    // Composite transparent foreground over solid color background
    const compositeBuffer = await sharp({
      create: {
        width: bgResult.width,
        height: bgResult.height,
        channels: 4,
        background: params.color,
      },
    })
      .composite([{ input: bgResult.buffer, blend: "over" }])
      .toFormat(params.format === "png" ? "png" : "jpeg", {
        quality: params.quality ?? 95,
      })
      .toBuffer();

    const meta = await sharp(compositeBuffer).metadata();
    return formatResult(
      compositeBuffer,
      meta.width ?? bgResult.width,
      meta.height ?? bgResult.height,
      meta.format ?? params.format,
      meta.density
    );
  }

  // Transparent output (always PNG)
  return formatResult(
    bgResult.buffer,
    bgResult.width,
    bgResult.height,
    "png"
  );
}

/**
 * Execute cropping of bounding box.
 */
export async function executeCrop(
  input: string | Buffer,
  params: CropInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);
  const result = await cropImage({
    inputBuffer: buffer,
    left: params.left,
    top: params.top,
    width: params.width,
    height: params.height,
    format: params.format ?? "jpeg",
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
 * Execute rotation and flip.
 */
export async function executeRotate(
  input: string | Buffer,
  params: RotateInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);
  const result = await rotateImage({
    inputBuffer: buffer,
    degrees: params.degrees ?? 0,
    flipHorizontal: params.flipHorizontal ?? false,
    flipVertical: params.flipVertical ?? false,
    format: params.format ?? "jpeg",
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
  params: CompressInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);
  const result = await compressImage({
    inputBuffer: buffer,
    targetSizeKb: params.targetSizeKb,
    quality: params.quality ?? 80,
    format: params.format ?? "jpeg",
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
  params: ConvertInput
): Promise<ImageOperationResult> {
  const { buffer } = parseImageInput(input);
  const result = await convertImage({
    inputBuffer: buffer,
    targetFormat: params.targetFormat,
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
 * Extract image metadata.
 */
export async function executeGetMetadata(input: string | Buffer) {
  const { buffer } = parseImageInput(input);
  return getImageMetadata(buffer);
}
