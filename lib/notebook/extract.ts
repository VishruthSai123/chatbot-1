import "server-only";

import { generateText } from "ai";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import { extractTextFromImage } from "@/lib/image/ocr";
import { readMediaSessionForUrl } from "@/lib/media/session";
import { fetchVideoTranscript } from "@/lib/media/transcript";
import { isVideoUrl } from "@/lib/media/url";
import { htmlToText } from "@/lib/net/html";
import { fetchPageText } from "@/lib/net/page";
import { extractPdfText } from "@/lib/pdf/native";
import { readSheetFile } from "@/lib/sheet/native";
import type { NotebookChunk } from "./chunk";
import { chunkText } from "./chunk";

/**
 * Reading the text out of a source.
 *
 * Every family already knows how to read itself: the PDF engine extracts text
 * per page, the sheet engine reads a workbook, the image engine does OCR. This
 * module is the one place that knows which to use for which file, so a notebook
 * can hold a PDF, a spreadsheet, a document, an image and a web page side by
 * side.
 */

/** One extracted piece of a source. */
export type ExtractedSection = {
  /** Where in the source it came from — "Page 3", "Sheet Q1", a URL. */
  label?: string;
  text: string;
};

export type ExtractionResult = {
  /** The text, ready to be chunked. */
  sections: ExtractedSection[];
  /** Why the source could not be read, when it could not. */
  error?: string;
  /** The title to show in the source list. */
  title?: string;
};

/** Reads a plain text or markdown file. */
function extractPlainText(buffer: Buffer): ExtractedSection[] {
  const text = buffer.toString("utf8");

  return text.trim() ? [{ text }] : [];
}

/**
 * The part of `mammoth` this app uses.
 *
 * `mammoth` is a CommonJS bundle whose shipped types do not survive the
 * bundler's module resolution cleanly, so the shape we rely on is declared here
 * instead. It is deliberately small: one function that turns a DOCX into text.
 */
type MammothReader = {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

/** Reads a DOCX into plain text. */
async function extractDocx(buffer: Buffer): Promise<ExtractedSection[]> {
  const imported = (await import("mammoth")) as unknown as {
    default?: MammothReader;
  } & MammothReader;
  const mammoth = imported.default ?? imported;
  const { value } = await mammoth.extractRawText({ buffer });

  return value.trim() ? [{ text: value }] : [];
}

/** Reads a presentation, one section per slide. */
async function extractPresentation(
  buffer: Buffer
): Promise<ExtractedSection[]> {
  const { extractPptxText } = await import("@/lib/doc/pptx");
  const { text, slideCount } = await extractPptxText(buffer);

  if (!text.trim()) {
    return [];
  }

  return [
    {
      label: `Presentation (${slideCount} slides)`,
      text,
    },
  ];
}

/** Reads a PDF, one section per page, so a citation can name the page. */
async function extractPdf(buffer: Buffer): Promise<ExtractedSection[]> {
  const { pages } = await extractPdfText(buffer);

  return pages
    .filter((page) => page.text.trim())
    .map((page) => ({ label: `Page ${page.page}`, text: page.text }));
}

/** Reads a spreadsheet, one section per sheet. */
async function extractSpreadsheet(
  buffer: Buffer,
  filename?: string
): Promise<ExtractedSection[]> {
  const workbook = await readSheetFile(buffer, filename);

  return workbook.sheets
    .filter((sheet) => sheet.rows.length > 0)
    .map((sheet) => {
      const lines = [
        sheet.headers.join(" | "),
        ...sheet.rows
          .slice(0, 500)
          .map((row) =>
            sheet.headers.map((header) => String(row[header] ?? "")).join(" | ")
          ),
      ];

      return { label: `Sheet ${sheet.name}`, text: lines.join("\n") };
    });
}

/** Reads an image with OCR. */
async function extractImage(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractedSection[]> {
  const { text } = await extractTextFromImage(buffer, mimeType);

  return text.trim() ? [{ text }] : [];
}

/**
 * Reads a web page.
 *
 * Using the model to read the page rather than fetching it ourselves is what
 * makes this work on real pages: script-rendered content, redirects and pages
 * that only exist behind a cookie are handled by the same mechanism that powers
 * `readUrl`.
 */
export async function extractUrl(
  url: string,
  userId?: string
): Promise<ExtractionResult> {
  // A video's words are more useful than its video page, so a video link is
  // read as its transcript rather than as a page of links and comments.
  if (isVideoUrl(url)) {
    // The user's own session, when they have connected one: Instagram and
    // Facebook will not serve a caption track to an anonymous visitor either.
    const cookies = userId
      ? await readMediaSessionForUrl({ url, userId })
      : undefined;
    const transcript = await fetchVideoTranscript({ cookies, url });

    if (transcript) {
      return {
        sections: [{ label: "Transcript", text: transcript.text }],
        title: transcript.title,
      };
    }
  }

  const instruction = [
    `Read the page at ${url}.`,
    "Return the full text content of the page, in reading order, with its headings.",
    "Do not summarise it and do not add commentary.",
  ].join("\n");

  // The page is fetched here, through the address checks, and the model is
  // given its text. No provider tool is involved.
  try {
    const page = await fetchPageText(url);
    const { text } = await generateText({
      model: getGroundingModel(),
      prompt: [instruction, "", "PAGE CONTENT:", page.text].join("\n"),
    });

    const cleaned = text.trim();

    return cleaned
      ? { sections: [{ label: url, text: cleaned }], title: url }
      : { error: "That page had no readable text.", sections: [], title: url };
  } catch (error: any) {
    console.warn("Notebook URL extraction failed:", error);
    return {
      error: error?.message ?? "That page could not be read.",
      sections: [],
      title: url,
    };
  }
}

/**
 * Reads a file into sections.
 *
 * The format is decided by the file's own bytes where possible, and by its
 * extension and media type otherwise — a mislabelled file should still be
 * readable.
 */
export async function extractFile({
  buffer,
  filename,
  mediaType,
}: {
  buffer: Buffer;
  filename?: string;
  mediaType?: string;
}): Promise<ExtractionResult> {
  const name = (filename ?? "").toLowerCase();
  const type = (mediaType ?? "").toLowerCase();

  try {
    /**
     * A PDF starts with `%PDF` — not with `PK`.
     *
     * `PK` is the ZIP magic, which every OOXML file also has, so checking it
     * here made every PPTX, DOCX and XLSX look like a PDF and fail with
     * "Invalid PDF structure" before it ever reached its own extractor.
     */
    const looksLikePdf =
      buffer.length > 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF";

    if (name.endsWith(".pdf") || type === "application/pdf" || looksLikePdf) {
      return { sections: await extractPdf(buffer) };
    }

    if (name.endsWith(".docx") || type.includes("wordprocessingml")) {
      return { sections: await extractDocx(buffer) };
    }

    if (
      name.endsWith(".pptx") ||
      type.includes("presentationml") ||
      type === "application/vnd.ms-powerpoint"
    ) {
      return { sections: await extractPresentation(buffer) };
    }

    if (
      name.endsWith(".html") ||
      name.endsWith(".htm") ||
      type === "text/html"
    ) {
      const text = htmlToText(buffer.toString("utf8"));

      return text ? { sections: [{ text }] } : { sections: [] };
    }

    if (
      name.endsWith(".csv") ||
      name.endsWith(".tsv") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xlsm") ||
      type.includes("spreadsheet") ||
      type === "text/csv"
    ) {
      return { sections: await extractSpreadsheet(buffer, filename) };
    }

    if (type.startsWith("image/")) {
      return { sections: await extractImage(buffer, type) };
    }

    if (
      name.endsWith(".txt") ||
      name.endsWith(".md") ||
      name.endsWith(".markdown") ||
      type.startsWith("text/")
    ) {
      return { sections: extractPlainText(buffer) };
    }

    return {
      error: `Files of type "${mediaType || "unknown"}" cannot be read yet.`,
      sections: [],
    };
  } catch (error: any) {
    console.warn("Notebook file extraction failed:", error);
    return {
      error: error?.message ?? "That file could not be read.",
      sections: [],
    };
  }
}

/**
 * Turns extracted sections into chunks.
 *
 * Sections keep their labels, so a chunk from page 12 of a PDF is cited as
 * "Page 12" and a chunk from a spreadsheet sheet is cited as "Sheet Q1".
 */
export function sectionsToChunks(
  sections: ExtractedSection[],
  startIndex = 0
): NotebookChunk[] {
  const chunks: NotebookChunk[] = [];
  let index = startIndex;

  for (const section of sections) {
    const produced = chunkText({
      label: section.label,
      startIndex: index,
      text: section.text,
    });

    chunks.push(...produced);
    index += produced.length;
  }

  return chunks;
}
