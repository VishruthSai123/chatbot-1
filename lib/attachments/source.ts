import "server-only";

import { mediaTypeFor } from "@/lib/attachments/media";
import { getDocumentById } from "@/lib/db/queries";
import { downloadArtifact } from "@/lib/storage";

/*
 * Getting the bytes behind an attachment.
 *
 * An attachment can be stored three ways, and the reader should not have to
 * know which:
 *
 * - an image is inline base64 in the document (it is small enough),
 * - a PDF, sheet, document or recording is a `*-ref:` envelope pointing at
 *   Supabase Storage,
 * - a plain text file may simply be its own content.
 *
 * This resolves all three into a buffer and a name, which is what every
 * extractor wants.
 */

export type SourceFile = {
  buffer: Buffer;
  filename: string;
  mediaType: string;
};

/** True when the text looks like bare base64 rather than a descriptor. */
function looksLikeBase64(value: string): boolean {
  return value.length > 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

/**
 * Reads the file behind a document.
 *
 * Returns nothing when the document does not belong to the user, which is the
 * same answer as "not found" on purpose: a caller should not be able to tell
 * the two apart.
 */
export async function readSourceDocument({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<SourceFile | null> {
  const document = await getDocumentById({ id: documentId });

  if (!document || document.userId !== userId) {
    return null;
  }

  const content = document.content ?? "";
  const filename = document.title || "attachment";
  const mediaType = mediaTypeFor(filename);

  // A descriptor points at storage.
  const storageKey = /"storageKey":"([^"]+)"/.exec(content)?.[1];

  if (storageKey) {
    try {
      return {
        buffer: await downloadArtifact(storageKey),
        filename,
        mediaType,
      };
    } catch (error) {
      console.warn("Could not download the attached file:", error);
      return null;
    }
  }

  // An image is inline base64.
  if (looksLikeBase64(content)) {
    return { buffer: Buffer.from(content, "base64"), filename, mediaType };
  }

  // Otherwise the content is the file's own text.
  if (content.trim()) {
    return {
      buffer: Buffer.from(content, "utf8"),
      filename,
      mediaType:
        mediaType === "application/octet-stream" ? "text/plain" : mediaType,
    };
  }

  return null;
}
