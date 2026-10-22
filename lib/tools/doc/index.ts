import "server-only";

import { generateText } from "ai";
import { z } from "zod";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import { getDocumentById, isValidUUID } from "@/lib/db/queries";
import { diffLines, readingStats, summariseDiff } from "@/lib/doc/diff";
import { parseDocument } from "@/lib/doc/native";
import { decodeDocRef } from "@/lib/doc/ref";
import { downloadArtifact } from "@/lib/storage";

/**
 * Reading documents for the tools.
 *
 * A document is stored as a file plus a `doc-ref:` descriptor. The text is
 * re-extracted on demand rather than trusted from the descriptor, because the
 * descriptor is a cache and the file is the truth — a document edited outside
 * the app must not be answered from a stale copy.
 */

export type LoadedDocument = {
  documentId: string;
  filename: string;
  format: string;
  /** The document's plain text. */
  text: string;
  title: string;
};

export class DocumentNotFoundError extends Error {
  constructor(message = "That document could not be opened.") {
    super(message);
    this.name = "DocumentNotFoundError";
  }
}

/**
 * Loads a document's text.
 */
export async function loadDocument({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<LoadedDocument> {
  if (!isValidUUID(documentId)) {
    throw new DocumentNotFoundError();
  }

  const document = await getDocumentById({ id: documentId });

  if (!document || document.userId !== userId) {
    throw new DocumentNotFoundError();
  }

  const ref = decodeDocRef(document.content);

  if (!ref) {
    throw new DocumentNotFoundError(
      "That file is not a document the studio can open."
    );
  }

  const buffer = await downloadArtifact(ref.storageKey);
  const parsed = await parseDocument({
    buffer,
    filename: ref.filename ?? document.title,
  });

  return {
    documentId,
    filename: ref.filename ?? document.title,
    format: parsed.format,
    text: parsed.text,
    title: ref.title ?? document.title,
  };
}

/**
 * Reads a document's structure and statistics.
 */
export async function readDocument({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<{
  characters: number;
  minutesToRead: number;
  outline: { level: number; text: string }[];
  paragraphs: number;
  sentences: number;
  text: string;
  words: number;
}> {
  const document = await loadDocument({ documentId, userId });
  const stats = readingStats(document.text);

  // The outline is flattened for the model: a nested tree costs tokens and the
  // model only needs the headings and their levels.
  const outline: { level: number; text: string }[] = [];

  const walk = (nodes: { level: number; text: string; children: any[] }[]) => {
    for (const node of nodes) {
      outline.push({ level: node.level, text: node.text });
      walk(node.children ?? []);
    }
  };

  const { extractOutline } = await import("@/lib/doc/diff");
  walk(extractOutline(document.text));

  return {
    characters: stats.characters,
    minutesToRead: stats.minutesToRead,
    outline,
    paragraphs: stats.paragraphs,
    sentences: stats.sentences,
    text: document.text,
    words: stats.words,
  };
}

/**
 * Compares two documents.
 */
export async function diffDocuments({
  documentIdA,
  documentIdB,
  userId,
}: {
  documentIdA: string;
  documentIdB: string;
  userId: string;
}): Promise<{
  added: number;
  removed: number;
  segments: { kind: "equal" | "insert" | "delete"; text: string }[];
  unchanged: number;
}> {
  const [first, second] = await Promise.all([
    loadDocument({ documentId: documentIdA, userId }),
    loadDocument({ documentId: documentIdB, userId }),
  ]);

  const segments = diffLines(first.text, second.text);

  return { ...summariseDiff(segments), segments };
}

/**
 * Summarises a document.
 */
export async function summarizeDocument({
  documentId,
  instruction,
  userId,
}: {
  documentId: string;
  instruction?: string;
  userId: string;
}): Promise<{ summary: string }> {
  const document = await loadDocument({ documentId, userId });

  const { text } = await generateText({
    model: getGroundingModel(),
    prompt: [
      "Summarise this document in Markdown.",
      instruction
        ? `Focus on this: ${instruction}`
        : "Lead with what the document is and its main point, then the supporting detail, in order of importance.",
      "Use only what the document says. Do not add facts, opinions or context it does not contain.",
      "",
      "DOCUMENT:",
      document.text,
    ].join("\n"),
  });

  return { summary: text };
}

/**
 * Converts a document to another format.
 *
 * DOCX to Markdown is the conversion that matters, and `mammoth` gives it
 * directly: the semantic HTML it produces is a faithful Markdown-ish document
 * with real headings and lists, which is what a writer wants out of a DOCX.
 */
export async function convertDocument({
  documentId,
  targetFormat,
  userId,
}: {
  documentId: string;
  targetFormat: "md" | "txt";
  userId: string;
}): Promise<{ content: string; format: "md" | "txt" }> {
  const document = await loadDocument({ documentId, userId });

  if (targetFormat === "txt") {
    return { content: document.text, format: "txt" };
  }

  // The text is already plain; the Markdown version keeps the heading markers
  // that the outline was built from.
  const { extractOutline } = await import("@/lib/doc/diff");
  const headings = extractOutline(document.text);

  let content = document.text;

  for (const heading of headings) {
    const marker = "#".repeat(heading.level);
    content = content.replace(
      new RegExp(`^${escapeRegExp(heading.text)}\\s*$`, "m"),
      `${marker} ${heading.text}`
    );
  }

  return { content, format: "md" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The schema for a structured summary, used by the studio. */
export const summarySchema = z.object({
  sections: z
    .array(
      z.object({
        body: z.string(),
        heading: z.string(),
      })
    )
    .min(1),
});
