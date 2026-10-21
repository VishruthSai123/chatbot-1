import "server-only";

import {
  getDocumentById,
  getDocumentsById,
  isValidUUID,
} from "@/lib/db/queries";
import {
  decodeImageCollection,
  decodeImageRef,
  isImageCollection,
  isImageRef,
} from "@/lib/image/ref";
import { activeImageRegistry } from "@/lib/image/session-registry";
import { downloadArtifact } from "@/lib/storage";

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
 * Every branch enforces `userId` ownership.
 */
export type ResolvedDocumentImage = {
  base64: string;
  documentId: string;
  /** True when this is the newest version, i.e. safe to promote to the registry. */
  isHead: boolean;
  title: string;
  format?: string;
  height?: number;
  sizeBytes?: number;
  storageKey?: string;
  thumbUrl?: string;
  url?: string;
  width?: number;
};

async function parseRowContent(content: string): Promise<{
  base64: string;
  format?: string;
  height?: number;
  sizeBytes?: number;
  storageKey?: string;
  thumbUrl?: string;
  url?: string;
  width?: number;
}> {
  if (isImageRef(content)) {
    const ref = decodeImageRef(content);
    if (ref?.storageKey) {
      const buffer = await downloadArtifact(ref.storageKey);
      return {
        base64: buffer.toString("base64"),
        format: ref.format,
        height: ref.height,
        sizeBytes: ref.sizeBytes ?? buffer.length,
        storageKey: ref.storageKey,
        thumbUrl: ref.thumbUrl,
        url: ref.url,
        width: ref.width,
      };
    }
  }

  if (isImageCollection(content)) {
    const col = decodeImageCollection(content);
    const item =
      col?.items.find((i) => i.documentId === col.activeId) || col?.items[0];
    if (item?.storageKey) {
      const buffer = await downloadArtifact(item.storageKey);
      return {
        base64: buffer.toString("base64"),
        format: item.format,
        height: item.height,
        sizeBytes: item.sizeBytes ?? buffer.length,
        storageKey: item.storageKey,
        thumbUrl: item.thumbUrl,
        url: item.url,
        width: item.width,
      };
    }
  }

  return {
    base64: content,
  };
}

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

  const cacheHead = (
    row: {
      id: string;
      title: string;
    },
    base64: string
  ) => {
    activeImageRegistry.setActiveImage({
      base64,
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

      if (requested?.userId === userId && requested.content) {
        const isHead = versionIndex === versions.length - 1;
        const parsed = await parseRowContent(requested.content);

        if (isHead) {
          cacheHead(requested, parsed.base64);
        }

        return {
          base64: parsed.base64,
          documentId: requested.id,
          format: parsed.format,
          height: parsed.height,
          isHead,
          sizeBytes: parsed.sizeBytes,
          storageKey: parsed.storageKey,
          thumbUrl: parsed.thumbUrl,
          title: requested.title,
          url: parsed.url,
          width: parsed.width,
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
      const parsed = await parseRowContent(doc.content);
      cacheHead(doc, parsed.base64);
      return {
        base64: parsed.base64,
        documentId: doc.id,
        format: parsed.format,
        height: parsed.height,
        isHead: true,
        sizeBytes: parsed.sizeBytes,
        storageKey: parsed.storageKey,
        thumbUrl: parsed.thumbUrl,
        title: doc.title,
        url: parsed.url,
        width: parsed.width,
      };
    }
  } catch (error) {
    console.warn("Non-fatal: image document lookup failed:", error);
  }

  return null;
}
