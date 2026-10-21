import "server-only";

import { saveDocument } from "@/lib/db/queries";
import {
  collageImages,
  type OverlayPosition,
  overlayImage,
  type StitchDirection,
  stitchImages,
} from "@/lib/image/composite";
import { persistImageBytes } from "@/lib/image/persist";
import { resolveDocumentImage } from "@/lib/image/resolve-source";
import { generateUUID } from "@/lib/utils";
import type { ImageOperationResult } from "./types";

/**
 * Operations that combine several images into one.
 *
 * These differ from the rest of the image family in one important way: they do
 * not *edit* an image, they *build* a new one. A stitch of three photos is not
 * a version of any of them, so the result gets its own document rather than
 * overwriting the source.
 */

export type CompositeSource = {
  bytes: Buffer;
  documentId: string;
  title: string;
};

/**
 * Loads the bytes of several image documents.
 *
 * Ownership is enforced per document by the resolver, and a document that
 * cannot be opened is skipped rather than aborting the whole operation — the
 * caller checks the count and reports what was actually used.
 */
export async function loadCompositeSources({
  documentIds,
  userId,
  versionIndex,
}: {
  documentIds: string[];
  userId: string;
  versionIndex?: number;
}): Promise<CompositeSource[]> {
  const sources: CompositeSource[] = [];

  for (const documentId of documentIds) {
    // biome-ignore lint/performance/noAwaitInLoops: one document at a time keeps peak memory flat
    const resolved = await resolveDocumentImage({
      documentId,
      userId,
      versionIndex,
    });

    if (!resolved?.base64) {
      continue;
    }

    sources.push({
      bytes: Buffer.from(resolved.base64, "base64"),
      documentId: resolved.documentId,
      title: resolved.title,
    });
  }

  return sources;
}

function toResult(
  buffer: Buffer,
  width: number,
  height: number,
  format: string
): ImageOperationResult {
  const base64 = buffer.toString("base64");
  const mimeType =
    format === "jpeg" || format === "jpg" ? "image/jpeg" : `image/${format}`;

  return {
    base64,
    buffer,
    dataUrl: `data:${mimeType};base64,${base64}`,
    format,
    height,
    sizeBytes: buffer.length,
    width,
  };
}

/**
 * Writes a produced composite to storage as its own document.
 *
 * The result is durable and downloadable, and it appears in the studio as a
 * normal image — a stitched strip is just an image, once it exists.
 */
async function persistComposite({
  buffer,
  chatId,
  format,
  height,
  title,
  userId,
  width,
}: {
  buffer: Buffer;
  chatId?: string;
  format: string;
  height: number;
  title: string;
  userId: string;
  width: number;
}): Promise<{ documentId: string; result: ImageOperationResult }> {
  const documentId = generateUUID();

  const ref = await persistImageBytes({
    bytes: buffer,
    chatId,
    filename: `${title.replace(/\.[^/.]+$/, "")}.${format}`,
    format,
    height,
    userId,
    width,
  });

  await saveDocument({
    content: `image-ref:${JSON.stringify(ref)}`,
    id: documentId,
    kind: "image",
    title,
    userId,
  });

  return {
    documentId,
    result: {
      ...toResult(buffer, width, height, format),
      storageKey: ref.storageKey,
      thumbUrl: ref.thumbUrl,
      url: ref.url,
    },
  };
}

export async function executeStitch({
  chatId,
  documentIds,
  direction = "vertical",
  gap = 0,
  background,
  title = "Stitched image",
  userId,
  versionIndex,
}: {
  chatId?: string;
  documentIds: string[];
  direction?: StitchDirection;
  gap?: number;
  background?: string;
  title?: string;
  userId: string;
  versionIndex?: number;
}): Promise<{
  documentId: string;
  result: ImageOperationResult;
  used: number;
}> {
  const sources = await loadCompositeSources({
    documentIds,
    userId,
    versionIndex,
  });

  if (sources.length < 2) {
    throw new Error(
      "Stitching needs at least two images that could be opened."
    );
  }

  const stitched = await stitchImages({
    background,
    buffers: sources.map((source) => source.bytes),
    direction,
    gap,
  });

  const persisted = await persistComposite({
    buffer: stitched.buffer,
    chatId,
    format: stitched.format,
    height: stitched.height,
    title,
    userId,
    width: stitched.width,
  });

  return { ...persisted, used: sources.length };
}

export async function executeOverlay({
  baseDocumentId,
  chatId,
  opacity = 1,
  overlayDocumentId,
  position = "bottom-right",
  scale = 0.4,
  title = "Overlaid image",
  userId,
  versionIndex,
}: {
  baseDocumentId: string;
  chatId?: string;
  opacity?: number;
  overlayDocumentId: string;
  position?: OverlayPosition;
  scale?: number;
  title?: string;
  userId: string;
  versionIndex?: number;
}): Promise<{ documentId: string; result: ImageOperationResult }> {
  const sources = await loadCompositeSources({
    documentIds: [baseDocumentId, overlayDocumentId],
    userId,
    versionIndex,
  });

  if (sources.length < 2) {
    throw new Error("Both the base and the overlay image must be openable.");
  }

  const [base, overlay] = sources;

  const overlaid = await overlayImage({
    base: base.bytes,
    opacity,
    overlay: overlay.bytes,
    position,
    scale,
  });

  const persisted = await persistComposite({
    buffer: overlaid.buffer,
    chatId,
    format: overlaid.format,
    height: overlaid.height,
    title,
    userId,
    width: overlaid.width,
  });

  return persisted;
}

export async function executeCollage({
  cellHeight = 400,
  chatId,
  columns,
  documentIds,
  gap = 12,
  background,
  title = "Collage",
  userId,
  versionIndex,
}: {
  cellHeight?: number;
  chatId?: string;
  columns?: number;
  documentIds: string[];
  gap?: number;
  background?: string;
  title?: string;
  userId: string;
  versionIndex?: number;
}): Promise<{
  documentId: string;
  result: ImageOperationResult;
  used: number;
}> {
  const sources = await loadCompositeSources({
    documentIds,
    userId,
    versionIndex,
  });

  if (sources.length < 2) {
    throw new Error(
      "A collage needs at least two images that could be opened."
    );
  }

  const collage = await collageImages({
    background,
    buffers: sources.map((source) => source.bytes),
    cellHeight,
    columns,
    gap,
  });

  const persisted = await persistComposite({
    buffer: collage.buffer,
    chatId,
    format: collage.format,
    height: collage.height,
    title,
    userId,
    width: collage.width,
  });

  return { ...persisted, used: sources.length };
}
