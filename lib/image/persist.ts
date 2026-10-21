import "server-only";

import { getSharp } from "@/lib/image/native";
import type { ImageRef } from "@/lib/image/ref";
import { getArtifactSignedUrl, uploadArtifact } from "@/lib/storage";
import { safeStorageFilename } from "@/lib/storage/limits";

const IMAGE_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function persistImageBytes({
  bytes,
  chatId,
  filename,
  format,
  height,
  userId,
  width,
}: {
  bytes: Buffer;
  chatId?: string;
  filename?: string;
  format?: string;
  height?: number;
  userId: string;
  width?: number;
}): Promise<ImageRef> {
  const sharp = await getSharp();
  let finalWidth = width;
  let finalHeight = height;
  let finalFormat = format;

  if (!finalWidth || !finalHeight || !finalFormat) {
    try {
      const meta = await sharp(bytes).metadata();
      finalWidth = meta.width ?? finalWidth;
      finalHeight = meta.height ?? finalHeight;
      finalFormat = meta.format ?? finalFormat ?? "png";
    } catch {
      finalFormat = finalFormat ?? "png";
    }
  }

  const cleanFormat = (finalFormat || "png")
    .toLowerCase()
    .replace("jpeg", "jpg");
  const baseName = safeStorageFilename(
    filename || `image-${Date.now()}.${cleanFormat}`
  );

  const mimeType =
    cleanFormat === "jpg" || cleanFormat === "jpeg"
      ? "image/jpeg"
      : `image/${cleanFormat}`;

  // 1. Upload full-resolution image
  const uploaded = await uploadArtifact({
    chatId,
    contentType: mimeType,
    fileBuffer: bytes,
    filename: baseName,
    userId,
  });

  // 2. Generate and upload 320px thumbnail for fast gallery rendering
  let thumbKey: string | undefined;
  let thumbUrl: string | undefined;

  try {
    const thumbBuffer = await sharp(bytes)
      .resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbUpload = await uploadArtifact({
      chatId,
      contentType: "image/webp",
      fileBuffer: thumbBuffer,
      filename: `thumb-${baseName.replace(/\.[^/.]+$/, "")}.webp`,
      userId,
    });

    thumbKey = thumbUpload.storageKey;
    thumbUrl = thumbUpload.url;
  } catch (err) {
    console.warn("Non-fatal: thumbnail generation failed:", err);
  }

  const url = await getArtifactSignedUrl(
    uploaded.storageKey,
    IMAGE_URL_TTL_SECONDS
  );

  return {
    filename: uploaded.pathname,
    format: cleanFormat,
    height: finalHeight,
    sizeBytes: uploaded.size,
    storageKey: uploaded.storageKey,
    thumbKey,
    thumbUrl: thumbUrl ?? url,
    url,
    width: finalWidth,
  };
}

export async function persistAndSaveImageDocument({
  buffer,
  chatId,
  documentId,
  format,
  height,
  title,
  userId,
  width,
}: {
  buffer: Buffer;
  chatId?: string;
  documentId: string;
  format?: string;
  height?: number;
  title: string;
  userId: string;
  width?: number;
}): Promise<ImageRef | null> {
  const { saveDocument } = await import("@/lib/db/queries");
  const { encodeImageRef } = await import("@/lib/image/ref");

  try {
    const ref = await persistImageBytes({
      bytes: buffer,
      chatId,
      filename: `${title.replace(/\.[^/.]+$/, "")}.${format || "png"}`,
      format,
      height,
      userId,
      width,
    });

    await saveDocument({
      content: encodeImageRef(ref),
      id: documentId,
      kind: "image",
      title,
      userId,
    });

    return ref;
  } catch (err) {
    console.warn("Storage upload failed, falling back to base64:", err);
    try {
      await saveDocument({
        content: buffer.toString("base64"),
        id: documentId,
        kind: "image",
        title,
        userId,
      });
    } catch (dbErr) {
      console.warn("Failed to save image document:", dbErr);
    }
    return null;
  }
}
