import "server-only";

import { degrees, PDFDocument } from "pdf-lib";

export type { PageRotation } from "./pages";

import { normaliseDegrees, parseSplitGroups, sanitisePageOrder } from "./pages";

/**
 * Native PDF manipulation.
 *
 * Everything here is pure `pdf-lib` in memory: no external service, no FFmpeg
 * binary, no ghostscript. The whole family therefore runs inside the existing
 * serverless function and costs nothing per operation.
 *
 * A deliberate constraint: these functions take and return `Buffer`s and never
 * touch storage or the database. That keeps them testable with a generated
 * fixture, and keeps orchestration (resolve → run → persist) in one place.
 */

export type PdfOperationResult = {
  author?: string;
  buffer: Buffer;
  /** Page count of the produced document. */
  pages: number;
  sizeBytes: number;
  /** Document title from the PDF info dictionary, when present. */
  title?: string;
  /** True when the source was encrypted and had to be loaded ignoring encryption. */
  wasEncrypted?: boolean;
};

/**
 * Loads a document, tolerating the common "encrypted but no password" case.
 *
 * Owner-password-only PDFs — the usual "protected" export from a scanner or an
 * office suite — open fine when encryption is ignored. Genuinely user-password
 * protected files still fail, and the caller surfaces that as a real error rather
 * than writing out a blank document.
 */
async function loadPdf(
  buffer: Buffer
): Promise<{ doc: PDFDocument; wasEncrypted: boolean }> {
  try {
    return { doc: await PDFDocument.load(buffer), wasEncrypted: false };
  } catch (error) {
    try {
      return {
        doc: await PDFDocument.load(buffer, { ignoreEncryption: true }),
        wasEncrypted: true,
      };
    } catch (innerError) {
      throw new Error(
        error instanceof Error ? error.message : "Could not load PDF document",
        { cause: innerError }
      );
    }
  }
}

function describe(
  doc: PDFDocument,
  buffer: Buffer,
  wasEncrypted: boolean
): PdfOperationResult {
  return {
    author: doc.getAuthor() ?? undefined,
    buffer,
    pages: doc.getPageCount(),
    sizeBytes: buffer.length,
    title: doc.getTitle() ?? undefined,
    wasEncrypted,
  };
}

/** Copies `pages` (1-based) out of `source` into a fresh document. */
async function copyPages(
  source: PDFDocument,
  pages: number[]
): Promise<PDFDocument> {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    pages.map((page) => page - 1)
  );

  for (const page of copied) {
    output.addPage(page);
  }

  return output;
}

export async function getPdfInfo(
  inputBuffer: Buffer
): Promise<PdfOperationResult> {
  const { doc, wasEncrypted } = await loadPdf(inputBuffer);

  return describe(doc, inputBuffer, wasEncrypted);
}

/** Merges documents in the order given. */
export async function mergePdfs(
  pdfBuffers: Buffer[]
): Promise<PdfOperationResult> {
  if (pdfBuffers.length === 0) {
    throw new Error("Nothing to merge: provide at least one PDF.");
  }

  if (pdfBuffers.length === 1) {
    // Still re-serialise so the caller always gets a normalised document.
    return await normalisePdf(pdfBuffers[0]);
  }

  const merged = await PDFDocument.create();
  let wasEncrypted = false;

  const loadedList = await Promise.all(pdfBuffers.map((b) => loadPdf(b)));
  for (const loaded of loadedList) {
    wasEncrypted = wasEncrypted || loaded.wasEncrypted;

    // copyPages copies each page's resources too, so fonts and images survive.
    // biome-ignore lint/performance/noAwaitInLoops: pages must be added sequentially
    const copied = await merged.copyPages(
      loaded.doc,
      loaded.doc.getPageIndices()
    );
    for (const page of copied) {
      merged.addPage(page);
    }
  }

  return describe(merged, Buffer.from(await merged.save()), wasEncrypted);
}

/**
 * Splits into one document per requested group.
 *
 * `"1-3; 4-6"` produces two files; a single group produces one, which is the
 * common "give me pages 2-5" case and should not force the caller to unpack an
 * array it will never use.
 */
export async function splitPdf({
  pageRanges,
  pdfBuffer,
}: {
  pdfBuffer: Buffer;
  pageRanges?: string;
}): Promise<PdfOperationResult[]> {
  const { doc: source, wasEncrypted } = await loadPdf(pdfBuffer);
  const groups = parseSplitGroups(pageRanges, source.getPageCount());

  const results: PdfOperationResult[] = [];

  for (const group of groups) {
    // biome-ignore lint/performance/noAwaitInLoops: split groups must be serialized — each copyPages mutates the source doc index
    const output = await copyPages(source, group);
    const outputBuffer = Buffer.from(await output.save());
    results.push(describe(output, outputBuffer, wasEncrypted));
  }

  if (results.length === 0) {
    throw new Error("No pages matched that range.");
  }

  return results;
}

/**
 * Reorders, deletes and rotates pages in one pass.
 *
 * Doing all three together matters: applying them as separate round trips would
 * re-encode and re-upload the file three times, and any intermediate failure
 * would leave the user with a half-edited document.
 */
export async function arrangePdfPages({
  pageOrder,
  pdfBuffer,
  rotations,
}: {
  pdfBuffer: Buffer;
  /** 1-based page order. Pages omitted here are dropped. */
  pageOrder?: number[];
  /** 1-based page number → absolute rotation in degrees. */
  rotations?: Record<number, number>;
}): Promise<PdfOperationResult> {
  const { doc: source, wasEncrypted } = await loadPdf(pdfBuffer);
  const order = sanitisePageOrder(pageOrder, source.getPageCount());
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    order.map((page) => page - 1)
  );

  copied.forEach((page, index) => {
    const rotation = rotations?.[order[index]];

    if (typeof rotation === "number") {
      // Absolute, not additive: the studio shows one canonical "this page is
      // sideways" state, so applying twice must not accumulate.
      page.setRotation(degrees(normaliseDegrees(rotation)));
    }

    output.addPage(page);
  });

  return describe(output, Buffer.from(await output.save()), wasEncrypted);
}

/**
 * Rotates pages by a relative angle.
 *
 * Relative here and absolute in `arrangePdfPages` is intentional: "rotate this
 * page 90°" from a chat instruction means *another* quarter turn, while the
 * studio's per-page control shows a final orientation the user is choosing.
 */
export async function rotatePdfPages({
  degrees: rotation,
  pageNumbers,
  pdfBuffer,
}: {
  pdfBuffer: Buffer;
  /** "all" or explicit 1-based page numbers. */
  pageNumbers?: number[] | "all";
  degrees: number;
}): Promise<PdfOperationResult> {
  const { doc: source, wasEncrypted } = await loadPdf(pdfBuffer);
  const total = source.getPageCount();
  const targets =
    pageNumbers === "all" || !pageNumbers
      ? new Set(Array.from({ length: total }, (_, index) => index + 1))
      : new Set(pageNumbers.filter((page) => page >= 1 && page <= total));

  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, source.getPageIndices());

  copied.forEach((page, index) => {
    if (targets.has(index + 1)) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(normaliseDegrees(current + rotation)));
    }

    output.addPage(page);
  });

  return describe(output, Buffer.from(await output.save()), wasEncrypted);
}

/** Re-serialises a document, dropping unused objects and stale xref entries. */
export async function normalisePdf(
  pdfBuffer: Buffer
): Promise<PdfOperationResult> {
  const { doc, wasEncrypted } = await loadPdf(pdfBuffer);
  const saved = Buffer.from(
    await doc.save({ addDefaultPage: false, useObjectStreams: true })
  );

  return describe(doc, saved, wasEncrypted);
}

/**
 * Extracts the text layer, page by page.
 *
 * Deliberately not `pdf-parse`: that package wraps an ancient `pdf.js` build and
 * pulls a debug harness that reads a fixture off disk on import, which is a poor
 * fit for a serverless bundle. `pdfjs-dist` is already needed for the studio
 * canvas, so the server reuses the same engine the browser renders with — text
 * extraction and thumbnails therefore agree about page count and ordering.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<{
  pages: { page: number; text: string }[];
  text: string;
  totalPages: number;
}> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    // Font substitution warnings are noise in logs, not actionable.
    verbosity: 0,
  });

  const doc = await loadingTask.promise;

  try {
    const pageNumbers = Array.from({ length: doc.numPages }, (_, i) => i + 1);

    const pages = await Promise.all(
      pageNumbers.map(async (pageNumber) => {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();

        // `hasEOL` carries the line structure; joining everything with a space
        // collapses a table into one unreadable run.
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) {
            continue;
          }
          text += item.str;
          text += item.hasEOL ? "\n" : " ";
        }

        return {
          page: pageNumber,
          text: text.replace(/[ \t]+\n/g, "\n").trim(),
        };
      })
    );

    return {
      pages,
      text: pages.map((entry) => entry.text).join("\n\n"),
      totalPages: doc.numPages,
    };
  } finally {
    // v6 exposes cleanup on the loading task, not the document proxy.
    await loadingTask.destroy();
  }
}
