/**
 * Pure rules for reading a PDF that may be a scan.
 *
 * Kept free of `server-only`, the model provider and `pdfjs` so the page-marker
 * parsing and the "is this a scan?" decision can be tested directly. The
 * provider call lives in `ocr.ts`.
 */

/** One page of text, or one block when the model did not mark pages. */
export type PdfReadPage = {
  /** 1-based page number, or `null` when the text could not be split by page. */
  page: number | null;
  text: string;
};

/**
 * A text layer below this many non-whitespace characters is treated as empty.
 *
 * Scanned PDFs often carry a handful of stray characters — a page number, a
 * scanner footer — so checking for exactly zero would still classify them as
 * readable and skip OCR.
 */
export const MIN_TEXT_CHARS = 24;

/** A page needs at least this many characters before its text layer is trusted. */
export const MIN_TEXT_CHARS_PER_PAGE = 8;

/** How many output tokens OCR may use, scaled to the document. */
export function ocrMaxOutputTokens(totalPages: number): number {
  return Math.min(32_768, Math.max(4096, Math.max(totalPages, 1) * 800));
}

/** True when the extracted text layer has enough text to answer from. */
export function hasUsableTextLayer(text: string, totalPages: number): boolean {
  const nonWhitespace = text.replace(/\s+/g, "").length;
  const threshold = Math.max(
    MIN_TEXT_CHARS,
    Math.max(totalPages, 1) * MIN_TEXT_CHARS_PER_PAGE
  );

  return nonWhitespace >= threshold;
}

/**
 * A page marker the model was asked to write: `--- Page 3 ---`.
 *
 * Markdown decorations are tolerated because models add them even when told not
 * to, and rejecting `## Page 3` would silently collapse a whole document into
 * one untitled section.
 */
const PAGE_MARKER =
  /^\s*[-–—*#>\s]*(?:page|pg\.?)\s+(\d{1,4})\s*(?:of\s+\d{1,4})?\s*[-–—*#>\s:]*$/i;

/** Text a model writes when a page is blank rather than transcribing it. */
function isNoTextSentinel(text: string): boolean {
  const cleaned = text
    .trim()
    .replace(/^[([{]+/, "")
    .replace(/[)\]}"'.,!]+$/, "")
    .trim()
    .toLowerCase();

  return (
    cleaned === "no text on this page" ||
    cleaned === "no text detected" ||
    cleaned === "no legible text" ||
    cleaned === "no legible text on this page" ||
    cleaned === "blank page" ||
    cleaned === "this page is blank"
  );
}

/**
 * The text that is actually content, with page markers and "this page is
 * blank" notes removed.
 *
 * Without this, a blank scan whose OCR output is only `--- Page 1 ---` plus
 * `(no text on this page)` would look like a readable source and create an
 * empty notebook — exactly the failure this module exists to prevent.
 */
function meaningfulContent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !PAGE_MARKER.test(line))
    .filter((line) => !isNoTextSentinel(line))
    .join("\n")
    .trim();
}

/**
 * Splits OCR output into pages using the markers the prompt requests.
 *
 * When the model ignored the markers there is no reliable way to recover page
 * boundaries, so the whole transcription is returned as one unlabelled block
 * rather than being attributed to the wrong pages.
 */
export function splitOcrPages(text: string, totalPages: number): PdfReadPage[] {
  const cleaned = text.trim();

  if (!cleaned) {
    return [];
  }

  const sections: { lines: string[]; page: number }[] = [];
  let current: { lines: string[]; page: number } | null = null;

  for (const line of cleaned.split(/\r?\n/)) {
    const match = PAGE_MARKER.exec(line);
    const page = match ? Number(match[1]) : null;
    const highestPlausiblePage = Math.max(totalPages, 1) + 1;

    if (
      page !== null &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= highestPlausiblePage
    ) {
      current = { lines: [], page };
      sections.push(current);
      continue;
    }

    current?.lines.push(line);
  }

  const pages = sections
    .map(({ lines, page }) => ({
      page,
      text: lines.join("\n").trim(),
    }))
    .filter((section) => meaningfulContent(section.text).length > 0);

  if (pages.length > 0) {
    return pages;
  }

  return meaningfulContent(cleaned) ? [{ page: null, text: cleaned }] : [];
}
