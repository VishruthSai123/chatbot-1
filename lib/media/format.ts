/*
 * Choosing what to download.
 *
 * Pure, so the rules can be tested without a network, a binary or a disk.
 *
 * The central problem this solves: platforms publish media in two different
 * shapes, and only one of them can be downloaded as a single file.
 *
 * - **Instagram, TikTok and Facebook** publish one file that already carries
 *   the picture and the sound together. It downloads as-is.
 * - **YouTube** publishes the picture and the sound as two separate streams.
 *   Joining them needs a muxer, and this deployment has no FFmpeg, so the two
 *   are downloaded separately and both are handed to the user.
 *
 * Asking for `best` alone is not enough: it picks whichever stream has the
 * best quality, which for YouTube is a picture with no sound at all. The
 * format expressions below say explicitly which streams are wanted.
 */

/** What a platform said about one of its streams. */
export type FormatSummary = {
  /** The audio codec, or "none"/"unknown" when the stream has no sound. */
  acodec?: null | string;
  /** The platform's name for the stream. */
  format_id?: null | string;
  /** The picture's height, when the stream has a picture. */
  height?: null | number;
  /** The video codec, or "none"/"unknown" when the stream has no picture. */
  vcodec?: null | string;
};

/** Whether a codec name means the stream really carries that codec. */
function hasCodec(codec: null | string | undefined): boolean {
  return Boolean(codec) && codec !== "none" && codec !== "unknown";
}

/** Whether a stream carries a picture. */
export function hasVideo(format: FormatSummary): boolean {
  return hasCodec(format.vcodec) && format.vcodec !== "audio only";
}

/** Whether a stream carries sound. */
export function hasAudio(format: FormatSummary): boolean {
  return hasCodec(format.acodec);
}

/**
 * Whether the platform publishes a single file carrying both streams.
 *
 * This is the difference between a one-file download and a two-file one, and
 * it is read from the platform's own description of its streams rather than
 * guessed from the host name.
 */
export function hasCombinedFormat(formats: FormatSummary[]): boolean {
  return formats.some(
    (format) => hasVideo(format) && hasAudio(format) && format.height
  );
}

/**
 * The formats the downloader will ask for.
 *
 * A format expression rather than a fixed list, so a quality choice maps onto
 * what the platform actually offers.
 *
 * - **A combined platform gets one file.** The expression insists on both
 *   streams being present, so the download can never come back silent.
 * - **A separated platform gets both streams.** The `+` asks for two files.
 *   Without FFmpeg they are not joined, and the caller is told so, rather than
 *   being handed one of them and left to guess why it has no sound.
 * - **The quality cap is a preference, not a promise.** The fallback is any
 *   stream, so a video offered only at 360p still downloads instead of failing.
 * - **The audio case asks for the original stream, not an extraction.**
 *   Extraction (`-x`) shells out to FFmpeg. The browser decodes the native
 *   stream, and the MP3 the user may want is produced in the browser.
 */
export function formatExpression({
  combined,
  format,
  quality,
}: {
  /** Whether the platform publishes one file carrying both streams. */
  combined: boolean;
  format: "video" | "audio";
  quality?: number;
}): string {
  if (format === "audio") {
    return "bestaudio/best";
  }

  const height = quality ?? 1080;

  if (combined) {
    return [
      `best[height<=${height}][vcodec!=none][acodec!=none]`,
      "best[vcodec!=none][acodec!=none]",
    ].join("/");
  }

  return [`bestvideo[height<=${height}]+bestaudio`, "bestvideo+bestaudio"].join(
    "/"
  );
}

/** What a downloaded file turned out to be. */
export type StreamKind = "audio" | "combined" | "video";

/** A downloaded file, and what is in it. */
export type ClassifiedFile = {
  /** The name the downloader gave it. */
  filename: string;
  /** What the file actually contains. */
  kind: StreamKind;
};

/**
 * Works out what each downloaded file is.
 *
 * The downloader names its files after the format they came from, and the
 * platform's own description of that format says whether it carries a
 * picture, a sound, or both. Reading it from there is more reliable than
 * guessing from the file extension, because a WebM can be either.
 *
 * Two name shapes have to be read:
 *
 * - `251.webm` — one file, one format.
 * - `395+251.f251.webm` — two formats asked for at once, so the downloader
 *   keeps the individual format id after the `.f`.
 */
export function classifyFiles(
  files: string[],
  formats: FormatSummary[]
): ClassifiedFile[] {
  const byId = new Map<string, FormatSummary>();

  for (const format of formats) {
    if (format.format_id) {
      byId.set(format.format_id, format);
    }
  }

  const classified: ClassifiedFile[] = [];

  for (const filename of files) {
    const format = byId.get(formatIdOf(filename));
    const picture = format ? hasVideo(format) : true;
    const sound = format ? hasAudio(format) : true;

    classified.push({
      filename,
      kind: picture && sound ? "combined" : picture ? "video" : "audio",
    });
  }

  return classified;
}

/**
 * The format a downloaded file came from.
 *
 * The extension is after the last dot, because a format id may itself contain
 * one. When several formats were asked for at once, the individual id is the
 * part after the `.f`.
 */
export function formatIdOf(filename: string): string {
  const merged = /\.f([^.]+)\.[^.]+$/.exec(filename);

  if (merged?.[1]) {
    return merged[1];
  }

  const dot = filename.lastIndexOf(".");

  return dot > 0 ? filename.slice(0, dot) : filename;
}
