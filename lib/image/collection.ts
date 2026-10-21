import "server-only";

import { saveDocument } from "@/lib/db/queries";
import {
  encodeImageCollection,
  type ImageCollectionItem,
  type ImageCollectionRef,
} from "@/lib/image/ref";
import { resolveDocumentImage } from "@/lib/image/resolve-source";
import { generateUUID } from "@/lib/utils";

/**
 * Building a multi-image collection.
 *
 * A *collection* is one document whose content is an `image-collection:`
 * envelope listing several other image documents. It is what makes the gallery
 * view possible: the studio opens one collection, shows a grid, and focuses a
 * single image at a time.
 *
 * The items are references, not copies. Each entry points at its own Document,
 * so editing one image inside a collection writes a new version of *that*
 * image's document, and the collection keeps pointing at the right place. The
 * alternative — copying the bytes into the collection — would duplicate every
 * photo and make the collection diverge from the originals.
 */

export type BuiltCollection = {
  items: ImageCollectionItem[];
  ref: ImageCollectionRef;
};

/**
 * Resolves a list of image documents into collection items.
 *
 * Documents the user does not own, or that hold no image, are skipped rather
 * than failing the whole call: a collection of nine photos where one was
 * deleted should still show eight.
 */
export async function buildCollection({
  documentIds,
  userId,
  versionIndex,
}: {
  documentIds: string[];
  userId: string;
  versionIndex?: number;
}): Promise<BuiltCollection | null> {
  const items: ImageCollectionItem[] = [];

  for (const documentId of documentIds) {
    // biome-ignore lint/performance/noAwaitInLoops: one document at a time keeps peak memory flat
    const resolved = await resolveDocumentImage({
      documentId,
      userId,
      versionIndex,
    });

    if (!resolved?.storageKey) {
      continue;
    }

    items.push({
      documentId: resolved.documentId,
      filename: resolved.title,
      format: resolved.format,
      height: resolved.height,
      sizeBytes: resolved.sizeBytes,
      storageKey: resolved.storageKey,
      thumbUrl: resolved.thumbUrl ?? resolved.url,
      title: resolved.title,
      url: resolved.url,
      width: resolved.width,
    });
  }

  if (items.length === 0) {
    return null;
  }

  const ref: ImageCollectionRef = {
    activeId: items[0].documentId,
    items,
  };

  return { items, ref };
}

/**
 * Creates the document that holds a collection.
 *
 * The collection is a document in its own right so that it can be reopened,
 * shared, and — importantly — so the model can be told which images are in play.
 */
export async function createCollectionDocument({
  chatId: _chatId,
  documentIds,
  title,
  userId,
  versionIndex,
}: {
  chatId?: string;
  documentIds: string[];
  title?: string;
  userId: string;
  versionIndex?: number;
}): Promise<{
  content: string;
  documentId: string;
  items: ImageCollectionItem[];
} | null> {
  const built = await buildCollection({ documentIds, userId, versionIndex });

  if (!built) {
    return null;
  }

  return await createCollectionFromItems({
    items: built.items,
    title,
    userId,
  });
}

/**
 * Creates a collection document from items that are already known.
 *
 * A batch operation has just produced each image and persisted it, so it
 * already holds the reference for every one. Re-resolving them from the
 * database would be wasted work — and would race the writes that just happened.
 */
export async function createCollectionFromItems({
  items,
  title,
  userId,
}: {
  items: ImageCollectionItem[];
  title?: string;
  userId: string;
}): Promise<{
  content: string;
  documentId: string;
  items: ImageCollectionItem[];
} | null> {
  if (items.length === 0) {
    return null;
  }

  const documentId = generateUUID();
  const ref: ImageCollectionRef = {
    activeId: items[0].documentId,
    items,
    title: title ?? "Image collection",
  };
  const content = encodeImageCollection(ref);

  try {
    await saveDocument({
      content,
      id: documentId,
      kind: "image",
      title: ref.title ?? "Image collection",
      userId,
    });
  } catch (error) {
    // The images themselves are safe and individually openable, so a failure to
    // index the album must not lose them.
    console.warn("Non-fatal: failed to persist image collection:", error);
    return null;
  }

  return { content, documentId, items };
}
