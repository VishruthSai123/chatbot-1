import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { guestRegex } from "@/lib/constants";
import {
  getLatestDocumentByKind,
  isValidUUID,
  saveDocument,
} from "@/lib/db/queries";
import { encodePdfRef } from "@/lib/pdf/ref";
import {
  executeArrange,
  executeExtractText,
  executeMerge,
  executePdfMetadata,
  executeRotatePdf,
  executeSplit,
  resolvePdfSource,
} from "@/lib/tools/pdf";
import {
  arrangeSchema,
  extractTextSchema,
  rotateSchema,
  splitSchema,
} from "@/lib/tools/pdf/types";
import type { ChatMessage } from "@/lib/types";

type PdfToolsProps = {
  session: Session;
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  chatId?: string;
  /**
   * PDF currently open in the right-pane studio. Lets a tool act on exactly what
   * the user is looking at when the model does not name a document.
   */
  activePdf?: {
    documentId?: string;
    versionIndex?: number;
  };
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/** Reveals the studio, pointed at the version a tool just wrote. */
function emitPdfArtifact(
  dataStream: UIMessageStreamWriter<ChatMessage> | undefined,
  payload: { id: string; title: string }
) {
  if (!dataStream) {
    return;
  }
  dataStream.write({ data: "pdf", transient: true, type: "data-kind" });
  dataStream.write({ data: payload.id, transient: true, type: "data-id" });
  dataStream.write({
    data: payload.title,
    transient: true,
    type: "data-title",
  });
  // The envelope is not written here: the panel resolves the document itself so it
  // always reads the newest version rather than a stale key in the stream.
  dataStream.write({ data: "", transient: true, type: "data-pdfDelta" });
  dataStream.write({ data: null, transient: true, type: "data-finish" });
}

/**
 * Finds the PDF a tool should act on: an explicit id, then the open studio, then
 * the newest PDF the user owns.
 */
async function resolveDocumentId({
  activePdf,
  documentId,
  userId,
}: {
  activePdf?: { documentId?: string };
  documentId?: string;
  userId: string;
}): Promise<string | undefined> {
  if (documentId && isValidUUID(documentId)) {
    return documentId;
  }

  if (activePdf?.documentId && isValidUUID(activePdf.documentId)) {
    return activePdf.documentId;
  }

  const latest = await getLatestDocumentByKind({ kind: "pdf", userId });

  return latest?.id;
}

/** Opens a version, enforcing ownership inside `resolvePdfSource`. */
async function openPdf({
  activePdf,
  documentId,
  userId,
}: {
  activePdf?: { documentId?: string; versionIndex?: number };
  documentId?: string;
  userId: string;
}) {
  const id = await resolveDocumentId({ activePdf, documentId, userId });

  if (!id) {
    return null;
  }

  return await resolvePdfSource({
    documentId: id,
    userId,
    versionIndex: activePdf?.versionIndex,
  });
}

/** Writes the produced file as the next version of the same document. */
async function saveVersion({
  documentId,
  pages,
  storageKey,
  title,
  userId,
}: {
  documentId: string;
  pages: number;
  storageKey: string;
  title: string;
  userId: string;
}): Promise<boolean> {
  try {
    await saveDocument({
      content: encodePdfRef({ pages, storageKey }),
      id: documentId,
      kind: "pdf",
      title,
      userId,
    });

    return true;
  } catch (error) {
    console.warn("Non-fatal: failed to persist PDF version from chat:", error);
    return false;
  }
}

export const pdfGetInfo = ({ activePdf, session }: PdfToolsProps) =>
  tool({
    description:
      "Report a PDF's page count, file size, title and author, and whether it was encrypted. Use this before answering questions about how many pages a document has.",
    execute: async ({ documentId }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to inspect PDFs." };
      }

      const source = await openPdf({
        activePdf,
        documentId,
        userId: session.user.id,
      });

      if (!source) {
        return { error: "I could not find that PDF in this chat." };
      }

      const metadata = await executePdfMetadata({ buffer: source.buffer });

      return { documentId: source.documentId, metadata, title: source.title };
    },
    inputSchema: z.object({
      documentId: z
        .string()
        .optional()
        .describe(
          "Document id from an attachment. Omit to use the PDF open in the studio."
        ),
    }),
  });

export const pdfMerge = ({
  activePdf,
  chatId,
  dataStream,
  session,
}: PdfToolsProps) =>
  tool({
    description:
      "Merge PDFs into one document, in the order given. The document open in the studio is included automatically unless its id is already listed.",
    execute: async ({ documentIds, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to merge PDFs." };
      }

      const userId = session.user.id;
      const activeId = await resolveDocumentId({ activePdf, userId });
      const ids = Array.from(
        new Set(
          [...(activeId ? [activeId] : []), ...(documentIds ?? [])].filter(
            (id) => isValidUUID(id)
          )
        )
      );

      if (ids.length < 2) {
        return {
          error:
            "Merging needs at least two PDFs. Attach the others, or name their document ids.",
        };
      }

      const sources = await Promise.all(
        ids.map((id) => resolvePdfSource({ documentId: id, userId }))
      );

      if (sources.some((source) => !source)) {
        return { error: "One of those documents could not be opened." };
      }

      const buffers: Buffer[] = sources.map(
        (source) => (source as NonNullable<typeof source>).buffer
      );

      const { result } = await executeMerge({
        context: { chatId, userId },
        inputs: buffers,
      });

      const mergedTitle = title || "Merged document";

      let mergedId: string | undefined;

      try {
        const saved = await saveDocument({
          content: encodePdfRef({
            pages: result.pages,
            storageKey: result.storageKey,
          }),
          id: crypto.randomUUID(),
          kind: "pdf",
          title: mergedTitle,
          userId,
        });
        mergedId = saved?.[0]?.id;
      } catch (error) {
        console.warn("Non-fatal: failed to persist merged PDF:", error);
      }

      if (mergedId) {
        emitPdfArtifact(dataStream, { id: mergedId, title: mergedTitle });
      }

      return {
        documentId: mergedId,
        mergedCount: ids.length,
        pages: result.pages,
        sizeBytes: result.sizeBytes,
        title: mergedTitle,
        url: result.url,
      };
    },
    inputSchema: z.object({
      documentIds: z
        .array(z.string())
        .optional()
        .describe(
          "Document ids of the other PDFs to merge, from the attachments. The studio's document is included automatically."
        ),
      title: z.string().max(120).optional().describe("Title for the result."),
    }),
  });

export const pdfSplit = ({
  activePdf,
  chatId,
  dataStream,
  session,
}: PdfToolsProps) =>
  tool({
    description:
      'Split a PDF into one or more files, or extract selected pages. Use ";" between output groups: "1-3; 4-6" produces two files, while "2-5" produces one.',
    execute: async ({ documentId, pageRanges, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to split PDFs." };
      }

      const userId = session.user.id;
      const source = await openPdf({ activePdf, documentId, userId });

      if (!source) {
        return { error: "I could not find that PDF in this chat." };
      }

      const params = splitSchema.parse({ pageRanges });
      const { results } = await executeSplit({
        buffer: source.buffer,
        context: { chatId, userId },
        params,
      });

      const [first] = results;
      const nextTitle = title || source.title;

      // The first group advances the document's history; the others are separate
      // files the user can download but do not belong in this document's timeline.
      const persisted = await saveVersion({
        documentId: source.documentId,
        pages: first.pages,
        storageKey: first.storageKey,
        title: nextTitle,
        userId,
      });

      if (persisted) {
        emitPdfArtifact(dataStream, {
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        documentId: source.documentId,
        files: results.map((part) => ({
          filename: part.filename,
          pages: part.pages,
          sizeBytes: part.sizeBytes,
          url: part.url,
        })),
        pages: first.pages,
        sizeBytes: first.sizeBytes,
        title: nextTitle,
        url: first.url,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      pageRanges: z
        .string()
        .optional()
        .describe(
          'Pages to keep, 1-based. "2-5" keeps those pages in one file; "1-3; 4-6" makes two files. Omit to split every page.'
        ),
      title: z.string().max(120).optional(),
    }),
  });

export const pdfArrange = ({
  activePdf,
  chatId,
  dataStream,
  session,
}: PdfToolsProps) =>
  tool({
    description:
      "Reorder, remove or rotate pages of a PDF in one step. Send the complete new page order; any page left out is deleted. Rotations are absolute per page.",
    execute: async ({ documentId, pageOrder, rotations, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to edit PDFs." };
      }

      const userId = session.user.id;
      const source = await openPdf({ activePdf, documentId, userId });

      if (!source) {
        return { error: "I could not find that PDF in this chat." };
      }

      const params = arrangeSchema.parse({ pageOrder, rotations });
      const { result } = await executeArrange({
        buffer: source.buffer,
        context: { chatId, userId },
        params,
      });

      const nextTitle = title || source.title;
      const persisted = await saveVersion({
        documentId: source.documentId,
        pages: result.pages,
        storageKey: result.storageKey,
        title: nextTitle,
        userId,
      });

      if (persisted) {
        emitPdfArtifact(dataStream, {
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        documentId: source.documentId,
        pages: result.pages,
        sizeBytes: result.sizeBytes,
        title: nextTitle,
        url: result.url,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      pageOrder: z
        .array(z.number().int().min(1))
        .optional()
        .describe(
          "New 1-based page order, e.g. [3,1,2]. Pages omitted are removed."
        ),
      rotations: z
        .record(z.string(), z.number())
        .optional()
        .describe(
          'Absolute rotation per page keyed by page number, e.g. {"2": 90}.'
        ),
      title: z.string().max(120).optional(),
    }),
  });

export const pdfRotatePages = ({
  activePdf,
  chatId,
  dataStream,
  session,
}: PdfToolsProps) =>
  tool({
    description:
      "Rotate PDF pages by a relative angle (90, 180 or -90) clockwise, for all pages or a selection.",
    execute: async ({ degrees, documentId, pages, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to rotate PDFs." };
      }

      const userId = session.user.id;
      const source = await openPdf({ activePdf, documentId, userId });

      if (!source) {
        return { error: "I could not find that PDF in this chat." };
      }

      const params = rotateSchema.parse({ degrees, pages });
      const { result } = await executeRotatePdf({
        buffer: source.buffer,
        context: { chatId, userId },
        params,
      });

      const nextTitle = title || source.title;
      const persisted = await saveVersion({
        documentId: source.documentId,
        pages: result.pages,
        storageKey: result.storageKey,
        title: nextTitle,
        userId,
      });

      if (persisted) {
        emitPdfArtifact(dataStream, {
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        documentId: source.documentId,
        pages: result.pages,
        sizeBytes: result.sizeBytes,
        title: nextTitle,
        url: result.url,
      };
    },
    inputSchema: z.object({
      degrees: z
        .number()
        .min(-360)
        .max(360)
        .describe("Clockwise rotation in degrees; snapped to the nearest 90."),
      documentId: z.string().optional(),
      pages: z
        .union([z.literal("all"), z.array(z.number().int().min(1))])
        .optional()
        .describe('"all" or explicit 1-based page numbers.'),
      title: z.string().max(120).optional(),
    }),
  });

export const pdfExtractText = ({ activePdf, session }: PdfToolsProps) =>
  tool({
    description:
      "Extract the text layer of a PDF, page by page. Use this to read, summarise or quote a document. Scans without a text layer return little or nothing.",
    execute: async ({ documentId, pageRanges }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to read PDFs." };
      }

      const source = await openPdf({
        activePdf,
        documentId,
        userId: session.user.id,
      });

      if (!source) {
        return { error: "I could not find that PDF in this chat." };
      }

      const params = extractTextSchema.parse({ pageRanges });
      const extracted = await executeExtractText({
        buffer: source.buffer,
        params,
      });

      return {
        documentId: source.documentId,
        // Long documents would blow the context window; the first pages are enough
        // for the model to answer, and the studio shows the full text.
        text: extracted.text.slice(0, 24_000),
        totalPages: extracted.totalPages,
        truncated: extracted.text.length > 24_000,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      pageRanges: z
        .string()
        .optional()
        .describe('Pages to read, e.g. "1-3". Omit for the whole document.'),
    }),
  });
