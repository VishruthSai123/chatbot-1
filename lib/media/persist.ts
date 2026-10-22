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
 */
export async function storeDownloadedMedia({
  chatId,
  media,
  userId,
}: {
  chatId?: string;
  media: MediaResult;
  userId: string;
}): Promise<{
  documentId: string;
  filename: string;
  sizeBytes: number;
  storageKey: string;
  title: string;
  url: string;
}> {
  const extension = media.filename.split(".").pop() || "mp4";
  const filename = downloadFileName(media.title, extension);

  const uploaded = await uploadArtifact({
    chatId,
    contentType:
      extension === "mp3"
        ? "audio/mpeg"
        : extension === "m4a"
          ? "audio/mp4"
          : `video/${extension}`,
    fileBuffer: media.buffer,
    filename,
    userId,
  });

  const documentId = crypto.randomUUID();

  await saveDocument({
    content: `media-ref:${JSON.stringify({
      filename,
      format: media.format,
      sourceUrl: media.sourceUrl,
      storageKey: uploaded.storageKey,
      title: media.title,
    })}`,
    id: documentId,
    kind: "image",
    title: media.title,
    userId,
  });

  return {
    documentId,
    filename,
    sizeBytes: media.buffer.length,
    storageKey: uploaded.storageKey,
    title: media.title,
    url: uploaded.url,
  };
}
