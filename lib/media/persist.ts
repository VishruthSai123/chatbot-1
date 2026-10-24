import "server-only";

import { saveDocument } from "@/lib/db/queries";
import type { MediaResult } from "@/lib/media/download";
import { downloadFileName } from "@/lib/media/url";
import { uploadArtifact } from "@/lib/storage";

/**
 * Storing a downloaded file.
 *
 * The file goes into the user's own bucket and a document records it, so a
 * download is a real file they can come back to — not a link that expires in an
 * hour. The same step serves the API route and the chat tool, so a download made
 * from a conversation and one made from the route end up in exactly the same
 * place.
 *
 * A download that came in two parts — the picture and the sound, which is how
 * YouTube publishes its videos — is stored as two files, because that is what
 * it is. Joining them needs a muxer this deployment does not have.
 */

/** The stored description of one file. */
export type StoredMedia = {
  documentId: string;
  filename: string;
  sizeBytes: number;
  storageKey: string;
  url: string;
};

/** What a stored download looks like. */
export type StoredDownload = StoredMedia & {
  companion?: StoredMedia;
  title: string;
};

/**
 * The media type for a file, from its extension.
 */
function contentTypeFor(extension: string): string {
  if (extension === "mp3") {
    return "audio/mpeg";
  }

  if (extension === "m4a" || extension === "mp4" || extension === "aac") {
    return "audio/mp4";
  }

  if (extension === "webm" || extension === "opus" || extension === "ogg") {
    return "audio/webm";
  }

  if (extension === "wav") {
    return "audio/wav";
  }

  if (extension === "mka") {
    return "audio/x-matroska";
  }

  return `video/${extension}`;
}

/**
 * Stores one file and records it as a document.
 */
async function storeFile({
  buffer,
  chatId,
  extension,
  format,
  sourceUrl,
  title,
  userId,
}: {
  buffer: Buffer;
  chatId?: string;
  extension: string;
  format: "video" | "audio";
  sourceUrl: string;
  title: string;
  userId: string;
}): Promise<StoredMedia> {
  const filename = downloadFileName(title, extension);

  const uploaded = await uploadArtifact({
    chatId,
    contentType: contentTypeFor(extension),
    fileBuffer: buffer,
    filename,
    userId,
  });

  const documentId = crypto.randomUUID();

  await saveDocument({
    content: `media-ref:${JSON.stringify({
      filename,
      format,
      sourceUrl,
      storageKey: uploaded.storageKey,
      title,
    })}`,
    id: documentId,
    kind: "image",
    title,
    userId,
  });

  return {
    documentId,
    filename,
    sizeBytes: buffer.length,
    storageKey: uploaded.storageKey,
    url: uploaded.url,
  };
}

export async function storeDownloadedMedia({
  chatId,
  media,
  userId,
}: {
  chatId?: string;
  media: MediaResult;
  userId: string;
}): Promise<StoredDownload> {
  const extension = media.filename.split(".").pop() || "mp4";

  const stored = await storeFile({
    buffer: media.buffer,
    chatId,
    extension,
    format: media.format,
    sourceUrl: media.sourceUrl,
    title: media.title,
    userId,
  });

  /**
   * The sound track, when it arrived apart from the picture.
   */
  let companion: StoredMedia | undefined;

  if (media.companion) {
    const companionExtension =
      media.companion.filename.split(".").pop() || "webm";

    companion = await storeFile({
      buffer: media.companion.buffer,
      chatId,
      extension: companionExtension,
      format: "audio",
      sourceUrl: media.sourceUrl,
      title: media.title,
      userId,
    });
  }

  return {
    ...stored,
    companion,
    title: media.title,
  };
}
