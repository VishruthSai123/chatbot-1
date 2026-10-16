import "server-only";

import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai/providers";

const OCR_MODEL_ID = "google/gemini-2.5-flash";

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

/**
 * Extract text (OCR) from an image using the Gemini multimodal vision model.
 * Purely native to our own pipeline — no external OCR SaaS.
 */
export async function extractTextFromImage(
  inputBuffer: Buffer,
  mimeType = "image/png"
): Promise<OcrResult> {
  const { text } = await generateText({
    instructions: OCR_INSTRUCTION,
    messages: [
      {
        content: [
          {
            text: "Extract all text from this image and return it as Markdown.",
            type: "text",
          },
          { image: inputBuffer, mediaType: mimeType, type: "image" },
        ],
        role: "user",
      },
    ],
    model: getLanguageModel(OCR_MODEL_ID),
  });

  const cleaned = text.trim();

  return {
    model: OCR_MODEL_ID.replace("google/", ""),
    text: cleaned,
    wordCount: cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0,
  };
}
