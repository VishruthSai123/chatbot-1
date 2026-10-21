import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { guestRegex } from "@/lib/constants";
import {
  getLatestDocumentByKind,
  getRecentDocumentsByKind,
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
  messages?: ChatMessage[];
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

/** Extracts PDF attachments from conversation messages. */
function extractPdfAttachmentsFromMessages(messages?: ChatMessage[]): {
  documentId?: string;
  name?: string;
  url?: string;
}[] {
  if (!messages || messages.length === 0) {
    return [];
  }

  const results: { documentId?: string; name?: string; url?: string }[] = [];
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages.at(-1);

  if (lastUserMsg?.parts) {
    for (const part of lastUserMsg.parts) {
      if (part.type === "file") {
        const filePart = part as {
          documentId?: string;
          mediaType?: string;
          name?: string;
          url?: string;
        };
        const isPdf =
          filePart.mediaType === "application/pdf" ||
          filePart.name?.toLowerCase().endsWith(".pdf") ||
          filePart.url?.toLowerCase().includes(".pdf");
        if (isPdf) {
          results.push({
            documentId: filePart.documentId,
            name: filePart.name,
            url: filePart.url,
          });
        }
      }
    }
  }

  if (results.length === 0) {
    for (let i = userMessages.length - 1; i >= 0; i -= 1) {
      const msg = userMessages[i];
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.type === "file") {
            const filePart = part as {
              documentId?: string;
              mediaType?: string;
              name?: string;
              url?: string;
            };
            const isPdf =
              filePart.mediaType === "application/pdf" ||
              filePart.name?.toLowerCase().endsWith(".pdf") ||
              filePart.url?.toLowerCase().includes(".pdf");
            if (isPdf) {
              results.push({
                documentId: filePart.documentId,
                name: filePart.name,
                url: filePart.url,
              });
            }
          }
        }
      }
      if (results.length > 0) {
        break;
      }
    }
  }

  return results;
}

/** Resolves an explicit string (UUID or filename) to a valid Document UUID. */
async function resolveSinglePdfId({
  candidate,
  messages,
  userId,
}: {
  candidate?: string;
  messages?: ChatMessage[];
  userId: string;
}): Promise<string | undefined> {
  if (candidate && isValidUUID(candidate)) {
    return candidate;
  }

  const searchName = candidate?.trim().toLowerCase();

  // 1. Search attachments in messages
  if (searchName && messages) {
    const attachments = extractPdfAttachmentsFromMessages(messages);
    const match = attachments.find((att) => {
      const n = (att.name || "").toLowerCase();
      return (
        n === searchName || n.includes(searchName) || searchName.includes(n)
      );
    });
    if (match?.documentId && isValidUUID(match.documentId)) {
      return match.documentId;
    }
  }

  // 2. Query user's recent PDF documents from database
  try {
    const recentDocs = await getRecentDocumentsByKind({
      kind: "pdf",
      limit: 20,
      userId,
    });

    if (searchName) {
      const match = recentDocs.find((d) => {
        const title = (d.title || "").toLowerCase();
        return (
          title === searchName ||
          title.includes(searchName) ||
          searchName.includes(title)
        );
      });
      if (match) {
        return match.id;
      }
    } else if (recentDocs.length > 0) {
      return recentDocs[0].id;
    }
  } catch (err) {
    console.warn("Non-fatal: failed to resolve PDF document by title:", err);
  }
}

/**
 * Finds the PDF a tool should act on: an explicit id or filename, then
 * an attached PDF from the user's latest message, then the open studio, then
 * the newest PDF the user owns.
 */
async function resolveDocumentId({
  activePdf,
  documentId,
  messages,
  userId,
}: {
  activePdf?: { documentId?: string };
  documentId?: string;
  messages?: ChatMessage[];
  userId: string;
}): Promise<string | undefined> {
  if (documentId) {
    const resolved = await resolveSinglePdfId({
      candidate: documentId,
      messages,
      userId,
    });
    if (resolved) {
      return resolved;
    }
  }

  // Check if user attached a PDF in the latest message
  if (messages) {
    const attached = extractPdfAttachmentsFromMessages(messages);
    if (
      attached.length > 0 &&
      attached[0].documentId &&
      isValidUUID(attached[0].documentId)
    ) {
      return attached[0].documentId;
    }
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
  messages,
  userId,
}: {
  activePdf?: { documentId?: string; versionIndex?: number };
  documentId?: string;
  messages?: ChatMessage[];
  userId: string;
}) {
  const id = await resolveDocumentId({
    activePdf,
    documentId,
    messages,
    userId,
  });

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

export const pdfGetInfo = ({ activePdf, messages, session }: PdfToolsProps) =>
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
        messages,
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
          "Document id or filename from an attachment. Omit to use the PDF attached or open in the studio."
        ),
    }),
  });

export const pdfMerge = ({
  activePdf,
  chatId,
  dataStream,
  messages,
  session,
}: PdfToolsProps) =>
  tool({
    description:
      "Merge multiple PDFs into one document, in the order given. If multiple PDFs are attached in the conversation, they are automatically detected and merged in attachment order.",
    execute: async ({ documentIds, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to merge PDFs." };
      }

      const userId = session.user.id;
      const resolvedIds: string[] = [];

      // 1. Explicit documentIds/filenames passed by the model
      if (documentIds && documentIds.length > 0) {
        const resolved = await Promise.all(
          documentIds.map((candidate) =>
            resolveSinglePdfId({ candidate, messages, userId })
          )
        );
        for (const id of resolved) {
          if (id && !resolvedIds.includes(id)) {
            resolvedIds.push(id);
          }
        }
      }

      // 2. Attachments from the current conversation turn
      if (resolvedIds.length < 2 && messages) {
        const attached = extractPdfAttachmentsFromMessages(messages);
        const resolvedAttached = await Promise.all(
          attached.map(async (att) => {
            if (att.documentId && isValidUUID(att.documentId)) {
              return att.documentId;
            }
            if (att.name) {
              const res = await resolveSinglePdfId({
                candidate: att.name,
                messages,
                userId,
              });
              return res ?? null;
            }
            return null;
          })
        );
        for (const id of resolvedAttached) {
          if (id && isValidUUID(id) && !resolvedIds.includes(id)) {
            resolvedIds.push(id);
          }
        }
      }

      // 3. Active document open in studio
      if (
        resolvedIds.length < 2 &&
        activePdf?.documentId &&
        isValidUUID(activePdf.documentId) &&
        !resolvedIds.includes(activePdf.documentId)
      ) {
        resolvedIds.unshift(activePdf.documentId);
      }

      // 4. Recent PDF documents from database
      if (resolvedIds.length < 2) {
        const recent = await getRecentDocumentsByKind({
          kind: "pdf",
          limit: 5,
          userId,
        });
        for (const doc of recent) {
          if (!resolvedIds.includes(doc.id)) {
            resolvedIds.push(doc.id);
            if (resolvedIds.length >= 2) {
              break;
            }
          }
        }
      }

      const ids = resolvedIds.filter((id) => isValidUUID(id));

      if (ids.length < 2) {
        return {
          error:
            "Merging needs at least two PDFs. Please attach the PDFs you want to merge.",
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
  messages,
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
      const source = await openPdf({ activePdf, documentId, messages, userId });

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
  messages,
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
      const source = await openPdf({ activePdf, documentId, messages, userId });

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
  messages,
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
      const source = await openPdf({ activePdf, documentId, messages, userId });

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

export const pdfExtractText = ({
  activePdf,
  messages,
  session,
}: PdfToolsProps) =>
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
        messages,
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
