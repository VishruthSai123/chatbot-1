/*
 * Recognising what a file is.
 *
 * Pure, so the mapping can be tested without touching storage.
 *
 * The upload route already knows the browser's content type, but a document
 * read back from the database only has its name. The extension is enough: the
 * upload allowlist is built from extensions, so anything that reached storage
 * has one we know.
 */

const MEDIA_TYPES: Record<string, string> = {
  aac: "audio/aac",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  flac: "audio/flac",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  m4a: "audio/mp4",
  markdown: "text/markdown",
  md: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** The media type for a filename, from its extension. */
export function mediaTypeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";

  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

/** True when a media type is an image. */
export function isImageType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

/** True when a media type is audio or video. */
export function isMediaType(mediaType: string): boolean {
  return mediaType.startsWith("audio/") || mediaType.startsWith("video/");
}
