import "server-only";

import { generateText } from "ai";

import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { getVisionModel, groundingModelId } from "@/lib/ai/search/grounding";

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
 * Extract text (OCR) from an image.
 *
 * This is a *vision* task, so it goes to the vision model rather than to
 * whatever model the conversation happens to be using: a text-only model
 * cannot read an image at all, and silently returning "no text detected" is
 * worse than saying the feature is unavailable.
 *
 * Purely native to our own pipeline — no external OCR SaaS.
 */
export async function extractTextFromImage(
  inputBuffer: Buffer,
  mimeType = "image/png"
): Promise<OcrResult> {
  const messages = [
    {
      content: [
        {
          text: "Extract all text from this image and return it as Markdown.",
          type: "text" as const,
        },
        { image: inputBuffer, mediaType: mimeType, type: "image" as const },
      ],
      role: "user" as const,
    },
  ];

  let text: string;
  let model = groundingModelId();

  try {
    ({ text } = await generateText({
      instructions: OCR_INSTRUCTION,
      messages,
      model: getVisionModel(),
    }));
  } catch (error) {
    // An exhausted Gemini key should not take OCR down with it: the chat
    // model may be able to see the image too.
    console.warn("Gemini OCR failed, trying the chat model:", error);

    model = DEFAULT_CHAT_MODEL;
    ({ text } = await generateText({
      instructions: OCR_INSTRUCTION,
      messages,
      model: getLanguageModel(DEFAULT_CHAT_MODEL),
    }));
  }

  const cleaned = text.trim();

  return {
    model,
    text: cleaned,
    wordCount: cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0,
  };
}
