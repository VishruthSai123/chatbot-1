import "server-only";

import { extractOutline, readingStats } from "./diff";
import type { DocFormat, DocOutlineNode, DocStats } from "./ref";

/**
 * Reading a document file.
 *
 * `mammoth` turns a DOCX into semantic HTML — real headings, real lists, real
 * tables — rather than the visual noise of the original layout. That matters
 * because the output is what the model reads and what the studio renders.
 */

export type ParsedDocument = {
  /** The document's plain text. */
  text: string;
  /** The heading tree. */
  outline: DocOutlineNode[];
  format: DocFormat;
  /** Reading statistics. */
  stats: DocStats;
};

/**
 * The part of `mammoth` this app uses.
 *
 * `mammoth` is a CommonJS bundle whose shipped types do not survive the
 * bundler's module resolution cleanly, so the shape we rely on is declared here.
 */
type MammothReader = {
  convertToHtml: (input: { buffer: Buffer }) => Promise<{
    messages: { message: string; type: string }[];
    value: string;
  }>;
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

async function loadMammoth(): Promise<MammothReader> {
  const imported = (await import("mammoth")) as unknown as {
    default?: MammothReader;
  } & MammothReader;

  return imported.default ?? imported;
}

/**
 * Turns HTML into the plain text the model reads.
 *
 * A regular expression is enough here and avoids a DOM parser in a serverless
 * function: block-level tags become line breaks, everything else is stripped.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/td>|<\/th>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reads a DOCX into text, an outline and statistics. */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await loadMammoth();
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const text = htmlToText(html);

  return {
    format: "docx",
    outline: extractOutline(text) as DocOutlineNode[],
    stats: readingStats(text),
    text,
  };
}

/** Reads a markdown or plain-text file. */
export function parseText(
  buffer: Buffer,
  format: "md" | "txt"
): ParsedDocument {
  const text = buffer.toString("utf8");

  return {
    format,
    outline: extractOutline(text) as DocOutlineNode[],
    stats: readingStats(text),
    text,
  };
}

/**
 * Reads any supported document.
 *
 * The format is decided by the extension, because a DOCX is a ZIP container and
 * the bytes would have to be sniffed to tell it from an XLSX — and the caller
 * already knows which file the user picked.
 */
export async function parseDocument({
  buffer,
  filename,
}: {
  buffer: Buffer;
  filename?: string;
}): Promise<ParsedDocument> {
  const name = (filename ?? "").toLowerCase();

  if (name.endsWith(".docx")) {
    return await parseDocx(buffer);
  }

  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return parseText(buffer, "md");
  }

  return parseText(buffer, "txt");
}
