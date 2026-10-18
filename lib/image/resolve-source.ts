import "server-only";

import {
  getDocumentById,
  getDocumentsById,
  isValidUUID,
} from "@/lib/db/queries";
import { activeImageRegistry } from "@/lib/image/session-registry";

/**
 * Which image bytes is an edit supposed to act on?
 *
 * Both entry points into image processing — the workbench's `/api/tools/image`
 * and the chat tools — have to answer that the same way, so the resolution lives
 * here once:
 *
 *   1. an explicit `versionIndex` (the version the UI is currently showing)
 *   2. the in-memory registry pin for that document (fast path, head only)
 *   3. the newest row for that document id
 *
 * Every branch enforces `userId` ownership. That matters: the previous
 * implementations looked a document up purely by client-supplied id, so any
 * signed-in user who guessed an id could process someone else's photo.
 */
export type ResolvedDocumentImage = {
  base64: string;
  documentId: string;
  /** True when this is the newest version, i.e. safe to promote to the registry. */
  isHead: boolean;
  title: string;
};

export async function resolveDocumentImage({
  chatId,
  documentId,
  userId,
  versionIndex,
}: {
  chatId?: string;
  documentId?: string;
  userId: string;
  versionIndex?: number;
}): Promise<ResolvedDocumentImage | null> {
  if (!(documentId && isValidUUID(documentId))) {
    return null;
  }

  const cacheHead = (row: {
    content: string | null;
    id: string;
    title: string;
  }) => {
    if (!row.content) {
      return;
    }
    activeImageRegistry.setActiveImage({
      base64: row.content,
      chatId,
      documentId: row.id,
      title: row.title,
      userId,
    });
  };

  if (typeof versionIndex === "number" && versionIndex >= 0) {
    try {
      const versions = await getDocumentsById({ id: documentId });
      const requested = versions[versionIndex];

      // Out-of-range or foreign versions are ignored rather than fatal: the
      // caller falls through to the head, which is the pre-versionIndex
      // behaviour every older client already relied on.
      if (requested?.userId === userId && requested.content) {
        const isHead = versionIndex === versions.length - 1;

        if (isHead) {
          cacheHead(requested);
        }

        return {
          base64: requested.content,
          documentId: requested.id,
          isHead,
          title: requested.title,
        };
      }
    } catch (error) {
      console.warn("Non-fatal: failed to resolve image version:", error);
    }
  }

  const cached = activeImageRegistry.getActiveImage({ documentId });
  if (cached?.base64) {
    return {
      base64: cached.base64,
      documentId,
      isHead: true,
      title: cached.title || "Photo",
    };
  }

  try {
    const doc = await getDocumentById({ id: documentId });
    if (doc?.userId === userId && doc.content) {
      cacheHead(doc);
      return {
        base64: doc.content,
        documentId: doc.id,
        isHead: true,
        title: doc.title,
      };
    }
  } catch (error) {
    console.warn("Non-fatal: image document lookup failed:", error);
  }

  return null;
}
