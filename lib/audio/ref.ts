/*
 * How an audio file is addressed.
 *
 * The same convention as every other family: the file lives in Supabase
 * Storage and `Document.content` holds a descriptor. An audio file is the
 * largest thing this app stores — a podcast is tens of megabytes — so keeping
 * it out of Postgres is not a nicety.
 */

export type AudioFormat =
  | "mp3"
  | "m4a"
  | "wav"
  | "flac"
  | "ogg"
  | "aac"
  | "opus"
  | "webm"
  | "m4v"
  | "mp4"
  | "other";

export type AudioRef = {
  /** Duration in seconds, when the container declares it. */
  duration?: number;
  filename?: string;
  format?: AudioFormat;
  /** The transcript, once it has been produced. */
  transcript?: string;
  /** Storage key of the media file. */
  storageKey: string;
  title?: string;
};

const AUDIO_REF_MARKER = "audio-ref:";

export function encodeAudioRef(ref: AudioRef): string {
  return `${AUDIO_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeAudioRef(
  content: string | null | undefined
): AudioRef | null {
  if (!content?.startsWith(AUDIO_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(AUDIO_REF_MARKER.length)
    ) as AudioRef;

    if (!parsed?.storageKey || typeof parsed.storageKey !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isAudioRef(content: string | null | undefined): boolean {
  return decodeAudioRef(content) !== null;
}

/** The media types the Audio Studio can open. */
export const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/ogg",
  "audio/aac",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

/** The extensions the Audio Studio can open. */
export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".wav",
  ".flac",
  ".ogg",
  ".aac",
  ".opus",
  ".webm",
  ".m4v",
  ".mp4",
  ".mov",
];

/**
 * True when a file is audio or video the studio can open.
 *
 * The extension is trusted over the media type: browsers routinely report an
 * unusual audio file as `application/octet-stream`, and the filename is never
 * wrong about the format the user actually chose.
 */
export function isAudioUpload(contentType: string, filename: string): boolean {
  const lower = filename.toLowerCase();

  if (AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return true;
  }

  return AUDIO_MIME_TYPES.includes(contentType);
}
