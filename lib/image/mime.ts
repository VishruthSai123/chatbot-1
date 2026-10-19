/**
 * MIME handling for images the browser holds as strings.
 *
 * Everything the studio stores is *bare* base64 (no `data:` prefix), so the
 * format has to be recovered from the bytes. Assuming PNG for everything is the
 * quiet bug: a JPEG cutout, a WebP compression result and an AVIF conversion all
 * end up mislabelled, which shows up as a download with the wrong extension or a
 * transparent preview for an opaque photo.
 */

import { sniffImageBytes } from "@/lib/image/signatures";

/** Characters of base64 needed to cover the container header (48 bytes). */
const HEAD_CHARS = 64;

const BASE64_ONLY = /^[A-Za-z0-9+/]+=*$/;

const DATA_URL = /^data:([^;,]+)[;,]?/;

const EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "image/webp": "webp",
};

/** MIME type of bare base64 image data, or `null` when it is not an image. */
export function sniffBase64ImageMime(base64: string): string | null {
  const cleaned = base64.replace(/\s+/g, "").slice(0, HEAD_CHARS);
  if (cleaned.length < 16 || !BASE64_ONLY.test(cleaned)) {
    return null;
  }

  const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return sniffImageBytes(bytes);
  } catch {
    return null;
  }
}

/**
 * MIME type of an image source: a `data:` URL keeps its declared type, remote
 * URLs fall back to the extension in the path, and bare base64 is sniffed.
 */
export function imageSrcMime(src: string): string {
  if (!src) {
    return "image/png";
  }

  const declared = DATA_URL.exec(src);
  if (declared?.[1]) {
    return declared[1];
  }

  const sniffed = sniffBase64ImageMime(src);
  if (sniffed) {
    return sniffed;
  }

  if (/\.(jpe?g)(\?|#|$)/i.test(src)) {
    return "image/jpeg";
  }
  if (/\.webp(\?|#|$)/i.test(src)) {
    return "image/webp";
  }
  if (/\.avif(\?|#|$)/i.test(src)) {
    return "image/avif";
  }
  if (/\.gif(\?|#|$)/i.test(src)) {
    return "image/gif";
  }

  return "image/png";
}

/** Promotes bare base64 to a data URL the DOM (and the clipboard) can use. */
export function imageSrcToDataUrl(src: string): string {
  if (!src) {
    return "";
  }
  if (/^(https?:|blob:|data:)/i.test(src)) {
    return src;
  }
  return `data:${imageSrcMime(src)};base64,${src}`;
}

/** File extension matching the image's real format. */
export function imageExtension(src: string): string {
  return EXTENSIONS[imageSrcMime(src)] ?? "png";
}

/**
 * Download filename for the image, so a saved cutout is a `.png` and a converted
 * photo keeps its own extension rather than always claiming to be a PNG.
 */
export function imageDownloadName(prefix: string, src: string): string {
  return `${prefix}-${Date.now()}.${imageExtension(src)}`;
}
