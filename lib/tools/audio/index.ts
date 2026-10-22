import "server-only";

import { readAudioInfo, transcribeAudio } from "@/lib/audio/native";
import { type AudioRef, decodeAudioRef, encodeAudioRef } from "@/lib/audio/ref";
import { getDocumentById, isValidUUID, saveDocument } from "@/lib/db/queries";
import { getArtifactSignedUrl } from "@/lib/storage";
import { safeStorageFilename } from "@/lib/storage/limits";

/**
 * Reading and writing audio documents.
 *
 * A document of kind "audio" holds an `audio-ref:` envelope: the storage key
 * of the media file, its metadata, and — once produced — its transcript.
 */

export type LoadedAudio = {
  documentId: string;
  duration?: number;
  filename: string;
  mimeType?: string;
  storageKey: string;
  title: string;
  transcript?: string;
  url: string;
};

/** How long a signed media URL stays valid. */
const MEDIA_URL_TTL_SECONDS = 60 * 60;

/**
 * Loads an audio document, with a URL the browser can play.
 */
export async function loadAudio({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<LoadedAudio | null> {
  if (!isValidUUID(documentId)) {
    return null;
  }

  const document = await getDocumentById({ id: documentId });

  if (!document || document.userId !== userId) {
    return null;
  }

  const ref = decodeAudioRef(document.content);

  if (!ref) {
    return null;
  }

  return {
    documentId,
    duration: ref.duration,
    filename: ref.filename ?? document.title,
    mimeType: ref.format,
    storageKey: ref.storageKey,
    title: ref.title ?? document.title,
    transcript: ref.transcript,
    url: await getArtifactSignedUrl(ref.storageKey, MEDIA_URL_TTL_SECONDS),
  };
}

/**
 * Reads an audio file's metadata.
 */
export async function audioInfo({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<{
  bitrate?: number;
  channels?: number;
  codec?: string;
  duration?: number;
  filename: string;
  format?: string;
  sampleRate?: number;
  sizeBytes: number;
  title?: string;
} | null> {
  const audio = await loadAudio({ documentId, userId });

  if (!audio) {
    return null;
  }

  const { downloadArtifact } = await import("@/lib/storage");
  const buffer = await downloadArtifact(audio.storageKey);
  const info = await readAudioInfo(buffer, audio.mimeType);

  return {
    bitrate: info.bitrate,
    channels: info.channels,
    codec: info.codec,
    duration: info.duration ?? audio.duration,
    filename: audio.filename,
    format: info.format,
    sampleRate: info.sampleRate,
    sizeBytes: info.sizeBytes,
    title: info.title ?? audio.title,
  };
}

/**
 * Transcribes an audio file and stores the transcript on the document.
 *
 * The transcript lives in the document's envelope rather than in a separate
 * artifact, so the studio can show it immediately and a notebook can use the
 * same file as a source without transcribing it twice.
 */
export async function transcribeDocumentAudio({
  documentId,
  instruction,
  userId,
}: {
  documentId: string;
  instruction?: string;
  userId: string;
}): Promise<{ documentId: string; transcript: string } | null> {
  const audio = await loadAudio({ documentId, userId });

  if (!audio) {
    return null;
  }

  const { transcript } = await transcribeAudio({
    audioUrl: audio.url,
    instruction,
    mimeType: audio.mimeType,
  });

  const document = await getDocumentById({ id: documentId });
  const ref = decodeAudioRef(document?.content) as AudioRef | null;

  if (ref) {
    try {
      await saveDocument({
        content: encodeAudioRef({ ...ref, transcript }),
        id: documentId,
        kind: "audio",
        title: audio.title,
        userId,
      });
    } catch (error) {
      // The transcript is still returned; failing to store it must not lose it.
      console.warn("Non-fatal: failed to store the audio transcript:", error);
    }
  }

  return { documentId, transcript };
}

/** The filename an audio download should use. */
export function audioDownloadName(title: string, format?: string): string {
  const base = safeStorageFilename(title.replace(/\.[^/.]+$/, ""));
  const extension = format && format !== "other" ? format : "mp3";

  return `${base}.${extension}`;
}
