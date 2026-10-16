import "server-only";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { getSharp } from "./native";

/**
 * Native background removal using @imgly/background-removal-node.
 *
 * This module runs entirely on-device — no external API calls.
 * The ONNX models are bundled directly in the package dist directory.
 */

// Lazy-load the module to avoid increasing cold start time for non-BG-removal requests
let removeBackgroundFn: ((blob: Blob, config?: any) => Promise<Blob>) | null =
  null;

async function getRemoveBackground() {
  if (!removeBackgroundFn) {
    const mod = await import("@imgly/background-removal-node");
    removeBackgroundFn = mod.removeBackground;
  }
  return removeBackgroundFn;
}

export interface BgRemovalResult {
  buffer: Buffer;
  format: "png";
  height: number;
  sizeBytes: number;
  width: number;
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

  // Compute publicPath directly to the installed package's dist folder
  const config: Record<string, any> = { model: "medium" };
  try {
    const distDir = path.dirname(
      require.resolve("@imgly/background-removal-node")
    );
    config.publicPath = `${pathToFileURL(distDir).href}/`;
  } catch {
    // fallback to library defaults
  }

  // The library expects a Blob input
  const inputBlob = new Blob([inputBuffer], { type: "image/png" });
  const resultBlob = await removeBackground(inputBlob, config);

  // Convert Blob back to Buffer
  const arrayBuffer = await resultBlob.arrayBuffer();
  const outputBuffer = Buffer.from(arrayBuffer);

  // Extract dimensions from the output
  const sharp = await getSharp();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    format: "png",
    height: meta.height ?? 0,
    sizeBytes: outputBuffer.length,
    width: meta.width ?? 0,
  };
}
