import "server-only";

import {
  getDocumentById,
  getDocumentsById,
  isValidUUID,
} from "@/lib/db/queries";
import {
  convertImagesToPdf,
  type ImageToPdfLayout,
} from "@/lib/pdf/images-to-pdf";
import {
  arrangePdfPages,
  extractPdfText,
  getPdfInfo,
  mergePdfs,
  rotatePdfPages,
  splitPdf,
} from "@/lib/pdf/native";
import { parsePageRanges } from "@/lib/pdf/pages";
import { decodePdfRef } from "@/lib/pdf/ref";
import {
  downloadArtifact,
  getArtifactSignedUrl,
  uploadArtifact,
} from "@/lib/storage";
import { safeStorageFilename } from "@/lib/storage/limits";
import type {
  ArrangeInput,
  ExtractTextInput,
  PdfOperationPayload,
  RotatePdfInput,
  SplitInput,
} from "./types";

export type PdfContext = {
  chatId?: string;
  documentId?: string;
  userId: string;
};

/** Preview links are short-lived; the studio re-signs whenever it remounts. */
export const PDF_URL_TTL_SECONDS = 60 * 60;

export type ResolvedPdfSource = {
  buffer: Buffer;
  documentId: string;
  filename: string;
  storageKey: string;
  title: string;
};

/**
 * Resolves which PDF bytes an operation should read.
 *
 * The same order the image family uses, for the same reason: the user may be
 * looking at an older version while a newer one is already on disk, and editing
 * "the head" instead of "the version on screen" silently destroys work.
 *
 * A version arrives either as a `pdf-ref:` envelope (what this family writes) or
 * as a bare storage key (what an upload writes), so both are accepted here and
 * callers never have to know which one they got.
 */
export async function resolvePdfSource({
  content,
  documentId,
  userId,
  versionIndex,
}: {
  content?: string;
  documentId?: string;
  userId: string;
  versionIndex?: number;
}): Promise<ResolvedPdfSource | null> {
  const fromContent = async (
    rawContent: string | null | undefined,
    id: string,
    title: string
  ): Promise<ResolvedPdfSource | null> => {
    if (!rawContent) {
      return null;
    }

    const ref = decodePdfRef(rawContent);
    const storageKey = ref?.storageKey ?? rawContent.trim();

    // Content that is neither an envelope nor a plausible key is not a PDF version.
    if (!storageKey?.includes("/")) {
      return null;
    }

    try {
      const buffer = await downloadArtifact(storageKey);
      return {
        buffer,
        documentId: id,
        filename: ref?.filename ?? safeStorageFilename(title || "document.pdf"),
        storageKey,
        title: title || "Document",
      };
    } catch (error) {
      console.warn("Non-fatal: failed to download PDF artifact:", error);
      return null;
    }
  };

  if (documentId && isValidUUID(documentId)) {
    if (typeof versionIndex === "number" && versionIndex >= 0) {
      try {
        const versions = await getDocumentsById({ id: documentId });
        const requested = versions[versionIndex];

        if (requested?.userId === userId) {
          const resolved = await fromContent(
            requested.content,
            requested.id,
            requested.title
          );

          if (resolved) {
            return resolved;
          }
        }
      } catch (error) {
        console.warn("Non-fatal: failed to resolve PDF version:", error);
      }
    }

    try {
      const doc = await getDocumentById({ id: documentId });

      if (doc?.userId === userId) {
        const resolved = await fromContent(doc.content, doc.id, doc.title);
        if (resolved) {
          return resolved;
        }
      }
    } catch (error) {
      console.warn("Non-fatal: PDF document lookup failed:", error);
    }
  }

  // Fallback: If content was provided directly by the client (e.g. current canvas version)
  if (content) {
    const direct = await fromContent(
      content,
      documentId && isValidUUID(documentId) ? documentId : crypto.randomUUID(),
      "Document"
    );
    if (direct) {
      return direct;
    }
  }

  return null;
}

/** What the studio needs to draw a version: a link, plus cheap layout facts. */
export async function describePdfSource(source: ResolvedPdfSource): Promise<{
  filename: string;
  pages: number;
  sizeBytes: number;
  storageKey: string;
  url: string;
}> {
  const info = await getPdfInfo(source.buffer);

  return {
    filename: source.filename,
    pages: info.pages,
    sizeBytes: info.sizeBytes,
    storageKey: source.storageKey,
    url: await getArtifactSignedUrl(source.storageKey, PDF_URL_TTL_SECONDS),
  };
}

/** Uploads produced bytes and returns everything the studio needs to show them. */
async function persistPdfBytes({
  bytes,
  chatId,
  filename,
  pages,
  userId,
}: {
  bytes: Buffer;
  chatId?: string;
  filename: string;
  pages: number;
  userId: string;
}): Promise<PdfOperationPayload> {
  const uploaded = await uploadArtifact({
    chatId,
    contentType: "application/pdf",
    fileBuffer: bytes,
    filename,
    userId,
  });

  return {
    filename: uploaded.pathname,
    pages,
    sizeBytes: uploaded.size,
    storageKey: uploaded.storageKey,
    // uploadArtifact signs for a week; re-sign so this family owns its own TTL.
    url: await getArtifactSignedUrl(uploaded.storageKey, PDF_URL_TTL_SECONDS),
  };
}

export async function executeMerge({
  context,
  inputs,
}: {
  context: PdfContext;
  inputs: Buffer[];
}): Promise<{ result: PdfOperationPayload }> {
  const merged = await mergePdfs(inputs);

  return {
    result: await persistPdfBytes({
      bytes: merged.buffer,
      chatId: context.chatId,
      filename: inputs.length > 1 ? "merged.pdf" : "document.pdf",
      pages: merged.pages,
      userId: context.userId,
    }),
  };
}

export async function executeSplit({
  buffer,
  context,
  params,
}: {
  buffer: Buffer;
  context: PdfContext;
  params: SplitInput;
}): Promise<{ results: PdfOperationPayload[] }> {
  const parts = await splitPdf({
    pageRanges: params.pageRanges,
    pdfBuffer: buffer,
  });

  const results: PdfOperationPayload[] = await Promise.all(
    parts.map((part, index) =>
      persistPdfBytes({
        bytes: part.buffer,
        chatId: context.chatId,
        // Numbering keeps split outputs distinct in storage and in the UI.
        filename:
          parts.length === 1
            ? "split.pdf"
            : `split-${index + 1}of${parts.length}.pdf`,
        pages: part.pages,
        userId: context.userId,
      })
    )
  );

  return { results };
}

export async function executeArrange({
  buffer,
  context,
  params,
}: {
  buffer: Buffer;
  context: PdfContext;
  params: ArrangeInput;
}): Promise<{ result: PdfOperationPayload }> {
  const rotations = params.rotations
    ? Object.fromEntries(
        Object.entries(params.rotations).map(([page, angle]) => [
          Number.parseInt(page, 10),
          angle,
        ])
      )
    : undefined;

  const arranged = await arrangePdfPages({
    pageOrder: params.pageOrder,
    pdfBuffer: buffer,
    rotations,
  });

  return {
    result: await persistPdfBytes({
      bytes: arranged.buffer,
      chatId: context.chatId,
      filename: "arranged.pdf",
      pages: arranged.pages,
      userId: context.userId,
    }),
  };
}

export async function executeRotatePdf({
  buffer,
  context,
  params,
}: {
  buffer: Buffer;
  context: PdfContext;
  params: RotatePdfInput;
}): Promise<{ result: PdfOperationPayload }> {
  const rotated = await rotatePdfPages({
    degrees: params.degrees,
    pageNumbers: params.pages,
    pdfBuffer: buffer,
  });

  return {
    result: await persistPdfBytes({
      bytes: rotated.buffer,
      chatId: context.chatId,
      filename: "rotated.pdf",
      pages: rotated.pages,
      userId: context.userId,
    }),
  };
}

export async function executeExtractText({
  buffer,
  params,
}: {
  buffer: Buffer;
  params: ExtractTextInput;
}): Promise<{
  pages: { page: number; text: string }[];
  text: string;
  totalPages: number;
}> {
  const extracted = await extractPdfText(buffer);

  if (!params.pageRanges) {
    return extracted;
  }

  // Filtering after extraction is deliberate: pdf.js still parses every page's
  // content streams to resolve shared resources, so asking for a subset would not
  // save the work — only complicate the call and the caching story.
  const wanted = new Set(
    parsePageRanges(params.pageRanges, extracted.totalPages)
  );
  const pages = extracted.pages.filter((entry) => wanted.has(entry.page));

  return {
    pages,
    text: pages.map((entry) => entry.text).join("\n\n"),
    totalPages: extracted.totalPages,
  };
}

export async function executePdfMetadata({
  buffer,
}: {
  buffer: Buffer;
}): Promise<{
  author?: string;
  pages: number;
  sizeBytes: number;
  title?: string;
  wasEncrypted?: boolean;
}> {
  const info = await getPdfInfo(buffer);

  return {
    author: info.author,
    pages: info.pages,
    sizeBytes: info.sizeBytes,
    title: info.title,
    wasEncrypted: info.wasEncrypted,
  };
}

export async function executeImagesToPdf({
  context,
  images,
  options,
}: {
  context: PdfContext;
  images: Array<{ buffer: Buffer; filename?: string; mimeType?: string }>;
  options?: {
    layout?: ImageToPdfLayout;
    margin?: number;
    title?: string;
  };
}): Promise<{ result: PdfOperationPayload }> {
  const converted = await convertImagesToPdf(images, options);

  const filename = options?.title
    ? `${safeStorageFilename(options.title)}.pdf`
    : images.length > 1
      ? "converted-images.pdf"
      : "converted-image.pdf";

  return {
    result: await persistPdfBytes({
      bytes: converted.buffer,
      chatId: context.chatId,
      filename,
      pages: converted.pages,
      userId: context.userId,
    }),
  };
}
