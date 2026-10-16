import "server-only";

import { getSharp } from "./native";

/**
 * Native background removal using @imgly/background-removal-node.
 *
 * This module runs entirely on-device — no external API calls.
 * The ONNX models are downloaded on first use and cached locally.
 *
 * Performance notes for Vercel serverless:
 * - First cold-start invocation downloads ~40MB of ONNX models → may take 10-15s.
 * - Subsequent invocations (within same container) use cached models → 2-5s.
 * - Output is always PNG with alpha transparency.
 */

// Lazy-load the module to avoid increasing cold start time for non-BG-removal requests
let removeBackgroundFn:
  | ((blob: Blob) => Promise<Blob>)
  | null = null;

async function getRemoveBackground() {
  if (!removeBackgroundFn) {
    const mod = await import("@imgly/background-removal-node");
    removeBackgroundFn = mod.removeBackground;
  }
  return removeBackgroundFn;
}

export interface BgRemovalResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png";
  sizeBytes: number;
}

/**
 * Remove the background from an image buffer.
 *
 * @param inputBuffer - The source image as a Buffer (JPEG, PNG, WebP).
 * @returns A PNG buffer with transparent background.
 */
export async function removeImageBackground(
  inputBuffer: Buffer
): Promise<BgRemovalResult> {
  const removeBackground = await getRemoveBackground();

  // The library expects a Blob input
  const inputBlob = new Blob([inputBuffer], { type: "image/png" });
  const resultBlob = await removeBackground(inputBlob);

  // Convert Blob back to Buffer
  const arrayBuffer = await resultBlob.arrayBuffer();
  const outputBuffer = Buffer.from(arrayBuffer);

  // Extract dimensions from the output
  const sharp = await getSharp();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: "png",
    sizeBytes: outputBuffer.length,
  };
}
