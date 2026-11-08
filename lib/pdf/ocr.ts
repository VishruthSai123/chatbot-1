import "server-only";

import { createHash } from "node:crypto";

import { generateText } from "ai";

import { getVisionModel } from "@/lib/ai/search/grounding";
import { formatBytes } from "@/lib/storage/limits";
import { extractPdfText } from "./native";
import {
  hasUsableTextLayer,
  ocrMaxOutputTokens,
  type PdfReadPage,
  splitOcrPages,
} from "./ocr-core";

export type { PdfReadPage } from "./ocr-core";

/**
 * Reading a PDF, including the scans that have no text layer.
 *
 * `extractPdfText` is the cheap, exact path: it reads the text the PDF already
 * carries. A scan or a photograph of handwritten notes has no such text, so the
 * document is sent to Gemini as a PDF — the model reads the page images
 * natively — and the transcription is split back into pages with the same
 * labels a text PDF would have.
 *
 * This is the one place both the notebook and the chat attachment paths call,
 * so a handwritten PDF behaves identically wherever a user drops it.
 */

export type PdfReadResult = {
  /** Why the document could not be read, when it could not. */
  error?: string;
  /** Which path produced the text. */
  method: "ocr" | "text";
  pages: PdfReadPage[];
  text: string;
  totalPages: number;
};

/**
 * Gemini accepts inline data up to roughly 20 MB for the whole request. Base64
 * inflates the bytes by a third, so a 12 MB PDF still fits with room for the
 * prompt and the response.
 */
const MAX_INLINE_PDF_BYTES = 12 * 1024 * 1024;

const OCR_INSTRUCTION = `You are a precise OCR and transcription engine for PDF documents.

Rules:
- Transcribe every page completely, in reading order.
- Start each page with a marker line exactly like: --- Page 1 ---
- Include handwriting, printed text, table cells, diagram labels and margin notes.
- Preserve headings, lists and line breaks. Render tables as GitHub-flavoured Markdown tables.
- Write mathematics in LaTeX between $...$.
- Do NOT translate, summarise, correct spelling, or add commentary.
- If a page has no legible text, write exactly: (no text on this page)
- Do not wrap the output in code fences.`;

/** One hour is long enough to cover a turn and a follow-up, short enough to retry. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Extracted text is small; this only stops a busy instance growing without bound. */
const MAX_CACHE_ENTRIES = 24;

const cache = new Map<string, { expiresAt: number; result: PdfReadResult }>();

function cacheKey(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function readCache(key: string): PdfReadResult | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  // Refresh the entry so eviction drops the genuinely old one.
  cache.delete(key);
  cache.set(key, entry);

  return entry.result;
}

function writeCache(key: string, result: PdfReadResult): void {
  // A transient OCR failure must not be cached: the next turn should be able to
  // try again rather than repeat the same error for an hour.
  if (result.error) {
    return;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();

    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

async function ocrPdf({
  buffer,
  totalPages,
}: {
  buffer: Buffer;
  totalPages: number;
}): Promise<{ pages: PdfReadPage[]; text: string }> {
  const { text } = await generateText({
    instructions: OCR_INSTRUCTION,
    maxOutputTokens: ocrMaxOutputTokens(totalPages),
    maxRetries: 1,
    messages: [
      {
        content: [
          {
            text: `Transcribe all ${totalPages} page${totalPages === 1 ? "" : "s"} of this PDF.`,
            type: "text",
          },
          {
            data: buffer,
            filename: "document.pdf",
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ],
    model: getVisionModel(),
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    },
  });

  const cleaned = text.trim();

  if (!cleaned) {
    return { pages: [], text: "" };
  }

  return { pages: splitOcrPages(cleaned, totalPages), text: cleaned };
}

async function readPdfUncached(pdfBuffer: Buffer): Promise<PdfReadResult> {
  const textLayer = await extractPdfText(pdfBuffer);
  const textResult: PdfReadResult = {
    method: "text",
    pages: textLayer.pages.map(({ page, text }) => ({ page, text })),
    text: textLayer.text,
    totalPages: textLayer.totalPages,
  };

  if (hasUsableTextLayer(textLayer.text, textLayer.totalPages)) {
    return textResult;
  }

  if (pdfBuffer.length > MAX_INLINE_PDF_BYTES) {
    return {
      ...textResult,
      error: `This PDF has no text layer and is ${formatBytes(pdfBuffer.length)}. OCR works up to ${formatBytes(MAX_INLINE_PDF_BYTES)}; split or compress the file and try again.`,
    };
  }

  try {
    const ocr = await ocrPdf({
      buffer: pdfBuffer,
      totalPages: textLayer.totalPages,
    });

    if (ocr.pages.length > 0) {
      return {
        method: "ocr",
        pages: ocr.pages,
        text: ocr.pages.map((page) => page.text).join("\n\n"),
        totalPages: textLayer.totalPages,
      };
    }

    return {
      ...textResult,
      error: "This PDF has no readable text, even after OCR.",
    };
  } catch (error) {
    // The text layer may still have a little text (a footer, a page number);
    // the caller decides whether that is enough to answer from.
    console.warn("PDF OCR fallback failed:", error);

    return {
      ...textResult,
      error: `This PDF has no text layer and OCR could not read it (${
        error instanceof Error ? error.message : "the OCR request failed"
      }).`,
    };
  }
}

/**
 * Reads a PDF into text, falling back to Gemini OCR when the text layer is
 * empty.
 *
 * Results are cached by content hash because the same file is commonly read
 * twice in one turn: once to give the chat model its attachment text and once
 * when a notebook or PDF tool opens it.
 */
export async function readPdf(pdfBuffer: Buffer): Promise<PdfReadResult> {
  const key = cacheKey(pdfBuffer);
  const cached = readCache(key);

  if (cached) {
    return cached;
  }

  const result = await readPdfUncached(pdfBuffer);
  writeCache(key, result);

  return result;
}
