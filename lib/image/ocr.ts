import "server-only";

import type { LanguageModel } from "ai";

import { getVisionModel } from "@/lib/ai/search/grounding";
import { type OcrResult, runOcr } from "./ocr-core";

export type { OcrResult } from "./ocr-core";

/**
 * Extract text (OCR) from an image.
 *
 * The image is validated and normalised first: bytes decide the media type,
 * unsupported formats are converted, and oversized images are downscaled.
 * That prevents the common Gemini 400s that used to surface as an empty OCR
 * result. The model is the dedicated vision model, never the chat model.
 */
export function extractTextFromImage(
  inputBuffer: Buffer,
  mimeType = "image/png",
  model: LanguageModel = getVisionModel()
): Promise<OcrResult> {
  return runOcr({ buffer: inputBuffer, mimeType, model });
}
