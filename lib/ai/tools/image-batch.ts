import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";

import type { ImageToolMode } from "@/components/chat/artifact";
import { guestRegex } from "@/lib/constants";
import { createCollectionFromItems } from "@/lib/image/collection";
import { persistAndSaveImageDocument } from "@/lib/image/persist";
import type { ImageCollectionItem } from "@/lib/image/ref";
import { resolveDocumentImage } from "@/lib/image/resolve-source";
import type { ImageOperationResult } from "@/lib/tools/image/types";
import type { ChatMessage } from "@/lib/types";
import { resolveImageReferences } from "./image-references";

/**
 * Applying one image operation to many images.
 *
 * The batch path exists because the single-image path cannot express "do this
 * to all twelve photos I attached". It reuses the *same* execute functions the
 * single-image tools use, so a batch resize and a single resize produce
 * byte-identical output — there is no second implementation to drift.
 *
 * Each image is edited in place: it becomes a new version of its own document.
 * The results are then gathered into a collection so the studio opens on a grid
 * of the edited images rather than on one arbitrary member.
 *
 * The references the model supplies are *filenames*, not document ids: the AI
 * SDK drops the document id when it converts a message for the provider. They
 * are resolved back to ids here, on the server, where the ids still exist.
 */

export type BatchOperation = (args: {
  documentId: string;
  source: string;
  title: string;
}) => Promise<ImageOperationResult>;

export type BatchOutcome = {
  collectionId?: string;
  errors: string[];
  processed: number;
  requested: number;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Emits the collection so the studio opens on the grid.
 *
 * The collection envelope travels as the artifact's content, which is exactly
 * what the workbench reads to decide between the gallery and the single-image
 * view.
 */
export function emitImageCollection(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  payload: { content: string; id: string; title: string }
) {
  dataStream.write({ data: "image", transient: true, type: "data-kind" });
  dataStream.write({ data: payload.id, transient: true, type: "data-id" });
  dataStream.write({
    data: payload.title,
    transient: true,
    type: "data-title",
  });
  dataStream.write({
    data: payload.content,
    transient: true,
    type: "data-imageDelta",
  });
  dataStream.write({ data: null, transient: true, type: "data-finish" });
}

/**
 * Runs an operation across several images and gathers the results.
 *
 * A failure on one image does not abandon the rest: the errors are collected
 * and reported, because a batch of twenty photos where one is corrupt should
 * still process nineteen.
 */
export async function runImageBatch({
  chatId,
  dataStream,
  messages,
  operation,
  references,
  session,
  title,
}: {
  chatId?: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  messages?: ChatMessage[];
  /** Filenames or document ids of the images to act on. */
  references: string[];
  operation: BatchOperation;
  session: Session;
  title: string;
}): Promise<BatchOutcome> {
  if (checkIsGuest(session)) {
    return {
      errors: ["Sign in to edit multiple images."],
      processed: 0,
      requested: references.length,
    };
  }

  const userId = session.user.id;
  const items: ImageCollectionItem[] = [];
  const errors: string[] = [];

  const { missing, resolved: targets } = await resolveImageReferences({
    chatId,
    messages,
    references,
  });

  for (const name of missing) {
    errors.push(`Could not find the image "${name}".`);
  }

  for (const target of targets) {
    if (!target.documentId) {
      // The attachment exists but carries no document, so it cannot be edited
      // in place and cannot become a version.
      errors.push(`"${target.name}" is not an editable image.`);
      continue;
    }

    const { documentId } = target;

    try {
      // biome-ignore lint/performance/noAwaitInLoops: one image at a time keeps peak memory flat; a batch of full-resolution photos would otherwise be decoded all at once
      const resolved = await resolveDocumentImage({
        chatId,
        documentId,
        userId,
      });

      if (!resolved?.base64) {
        errors.push(`Could not open ${resolved?.title ?? documentId}.`);
        continue;
      }

      const result = await operation({
        documentId: resolved.documentId,
        source: resolved.base64,
        title: resolved.title,
      });

      const persisted = await persistAndSaveImageDocument({
        buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
        chatId,
        documentId: resolved.documentId,
        format: result.format,
        height: result.height,
        title: resolved.title,
        userId,
        width: result.width,
      });

      if (persisted?.storageKey) {
        items.push({
          documentId: resolved.documentId,
          filename: persisted.filename,
          format: persisted.format,
          height: persisted.height,
          sizeBytes: persisted.sizeBytes,
          storageKey: persisted.storageKey,
          thumbUrl: persisted.thumbUrl,
          title: resolved.title,
          url: persisted.url,
          width: persisted.width,
        });
      }
    } catch (error: any) {
      errors.push(error?.message ?? `Failed on ${documentId}.`);
    }
  }

  let collectionId: string | undefined;

  if (items.length > 0) {
    const collection = await createCollectionFromItems({
      items,
      title,
      userId,
    });

    if (collection) {
      collectionId = collection.documentId;
      emitImageCollection(dataStream, {
        content: collection.content,
        id: collection.documentId,
        title,
      });
    }
  }

  return {
    collectionId,
    errors,
    processed: items.length,
    requested: references.length,
  };
}

/** The summary the model sees after a batch. */
export function describeBatchOutcome(
  outcome: BatchOutcome,
  operation: string
): string {
  if (outcome.processed === 0) {
    return `Could not ${operation} any images.`;
  }

  const failed = outcome.requested - outcome.processed;

  return failed > 0
    ? `${operation} ${outcome.processed} of ${outcome.requested} images; ${failed} failed.`
    : `${operation} ${outcome.processed} ${outcome.processed === 1 ? "image" : "images"}.`;
}

/** The tool mode the studio should open on after a batch. */
export const BATCH_TOOL_MODE: ImageToolMode = "resize";
