import { generateText, type LanguageModel } from "ai";

import { visionModel } from "@/lib/ai/models";
import {
  normalizeVisionImage,
  visionErrorMessage,
} from "@/lib/ai/vision-normalize";

export interface OcrResult {
  model: string;
  text: string;
  wordCount: number;
}

const OCR_INSTRUCTION = `You are a precise OCR engine. Extract ALL text visible in the provided image.

Rules:
- Preserve the natural reading order and line breaks.
- Represent tables as GitHub-flavoured Markdown tables.
- Preserve headings and lists with Markdown where it improves fidelity.
- Do NOT translate the text; return it exactly as written.
- Do NOT add commentary, explanations, or code fences.
- If the image contains no legible text, return exactly: (no text detected)`;

const NO_TEXT = "(no text detected)";

/**
 * The model-facing half of OCR, with the model injected.
 *
 * Kept free of `server-only` so the image validation, empty-result handling
 * and provider call can be tested with a mock model.
 */
export async function runOcr({
  buffer,
  mimeType,
  model,
}: {
  buffer: Buffer;
  mimeType?: string;
  model: LanguageModel;
}): Promise<OcrResult> {
  const image = await normalizeVisionImage({
    buffer,
    mediaType: mimeType,
  });

  try {
    const { text } = await generateText({
      instructions: OCR_INSTRUCTION,
      maxOutputTokens: 4096,
      maxRetries: 1,
      messages: [
        {
          content: [
            {
              text: "Extract all text from this image and return it as Markdown.",
              type: "text",
            },
            {
              data: image.buffer,
              filename: "image",
              mediaType: image.mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ],
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      },
    });

    const cleaned = text.trim();
    const noText = !cleaned || cleaned.toLowerCase() === NO_TEXT;

    return {
      model: visionModel.id,
      text: noText ? NO_TEXT : cleaned,
      wordCount: noText ? 0 : cleaned.split(/\s+/).filter(Boolean).length,
    };
  } catch (error) {
    throw new Error(visionErrorMessage(error), { cause: error });
  }
}
