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
 * Parses an image source (HTTP URL, Supabase signed URL, data URL, raw base64, or Buffer) into a Node Buffer.
 */
export async function parseImageInput(source: string | Buffer): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (Buffer.isBuffer(source)) {
    return { buffer: source, mimeType: "image/png" };
  }

  // Handle remote HTTP/HTTPS URLs (including Supabase Storage signed URLs)
  if (
    typeof source === "string" &&
    (source.startsWith("http://") || source.startsWith("https://"))
  ) {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch remote image: HTTP ${response.status} ${response.statusText}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type") || "image/png";
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  }

  const match = source.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    const [, mimeType, base64Data] = match;
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
  params: ResizePhysicalInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);
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
  params: RemoveBgInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);

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
      meta.format ?? params.format,
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
  params: CropInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);
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
  params: RotateInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);
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
  params: CompressInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);
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
  params: ConvertInput
): Promise<ImageOperationResult> {
  const { buffer } = await parseImageInput(input);
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
export async function executeGetMetadata(input: string | Buffer) {
  const { buffer } = await parseImageInput(input);
  return getImageMetadata(buffer);
}
