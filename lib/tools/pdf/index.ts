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
import { extractStorageKey } from "@/lib/storage/keys";
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
 * Tolerates:
 * - `pdf-ref:` envelopes (what this family writes)
 * - Bare Supabase storage keys (e.g. `userId/chatId/filename.pdf`)
 * - Full Supabase signed / public URLs
 * - External HTTP/HTTPS URLs
 * - Base64 Data URLs and raw base64 strings
 */
export async function resolvePdfSource({
  content,
  documentId,
  userId: _userId,
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
    if (!rawContent || typeof rawContent !== "string") {
      return null;
    }

    const trimmed = rawContent.trim();
    if (!trimmed) {
      return null;
    }

    const filename = safeStorageFilename(title || "document.pdf");

    // 1. Data URL (data:application/pdf;base64,...)
    if (trimmed.startsWith("data:application/pdf;base64,")) {
      try {
        const base64Data = trimmed.slice("data:application/pdf;base64,".length);
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.length > 0) {
          return {
            buffer,
            documentId: id,
            filename,
            storageKey: `direct-${id}`,
            title: title || "Document",
          };
        }
      } catch (err) {
        console.warn("Failed to parse base64 PDF data URL:", err);
      }
    }

    // 2. Raw base64 PDF ("JVBERi0" is the base64 prefix for "%PDF-")
    if (trimmed.startsWith("JVBERi0")) {
      try {
        const buffer = Buffer.from(trimmed, "base64");
        if (buffer.length > 0) {
          return {
            buffer,
            documentId: id,
            filename,
            storageKey: `direct-${id}`,
            title: title || "Document",
          };
        }
      } catch (err) {
        console.warn("Failed to parse raw base64 PDF string:", err);
      }
    }

    // 3. Encoded pdf-ref envelope
    const ref = decodePdfRef(trimmed);
    let storageKey = ref?.storageKey ?? trimmed;

    // 4. Extract storage key if a URL was stored as key
    const extracted = extractStorageKey(storageKey);
    if (extracted) {
      storageKey = extracted;
    }

    // 5. If storageKey is a Supabase bucket path (not http), download via admin client
    if (
      !storageKey.startsWith("http://") &&
      !storageKey.startsWith("https://")
    ) {
      try {
        const buffer = await downloadArtifact(storageKey);
        if (buffer.length > 0) {
          return {
            buffer,
            documentId: id,
            filename: ref?.filename ?? filename,
            storageKey,
            title: title || "Document",
          };
        }
      } catch (error) {
        console.warn(
          "Non-fatal: failed to download PDF artifact via storageKey:",
          error
        );
      }
    }

    // 6. If storageKey is an HTTP(S) URL, fetch directly
    if (storageKey.startsWith("http://") || storageKey.startsWith("https://")) {
      try {
        const response = await fetch(storageKey);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 0) {
            return {
              buffer,
              documentId: id,
              filename: ref?.filename ?? filename,
              storageKey,
              title: title || "Document",
            };
          }
        }
      } catch (error) {
        console.warn("Non-fatal: failed to fetch PDF via HTTP URL:", error);
      }
    }

    return null;
  };

  if (documentId && isValidUUID(documentId)) {
    if (typeof versionIndex === "number" && versionIndex >= 0) {
      try {
        const versions = await getDocumentsById({ id: documentId });
        const requested = versions[versionIndex];

        if (requested?.content) {
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

      if (doc?.content) {
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
  let pages = 1;
  let sizeBytes = source.buffer.length;

  try {
    const info = await getPdfInfo(source.buffer);
    ({ pages, sizeBytes } = info);
  } catch (error) {
    console.warn("Non-fatal: could not extract PDF info:", error);
  }

  let url = "";
  if (
    source.storageKey.startsWith("http://") ||
    source.storageKey.startsWith("https://")
  ) {
    url = source.storageKey;
  } else {
    try {
      url = await getArtifactSignedUrl(source.storageKey, PDF_URL_TTL_SECONDS);
    } catch (error) {
      console.warn("Non-fatal: failed to generate signed URL for PDF:", error);
    }
  }

  return {
    filename: source.filename,
    pages,
    sizeBytes,
    storageKey: source.storageKey,
    url,
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
