/**
 * Recognising raw base64 image data, and guessing its real format from the
 * decoded bytes.
 *
 * This exists because guessing from the *string* is not safe: base64 for a JPEG
 * always begins `"/9j/…"`, so a leading `/` looks exactly like a root-relative
 * URL. Anything that treats a leading slash as a path will misroute JPEG base64,
 * and the failure is silent — the image tools recover "gracefully" using
 * whichever image happened to be newest, so an edit aimed at an older version
 * quietly lands on the head instead. Decoding the first bytes and checking for a
 * real image signature is the only reliable test.
 */

const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;

/** Base64 for `\x89PNG\r\n\x1a\n`. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TEXT_ENCODING = "latin1";

/** How many decoded bytes are enough to identify every supported container. */
const SNIFF_BYTES = 32;

export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return "image/png";
  }

  if (buffer.subarray(0, 6).toString(TEXT_ENCODING) === "GIF87a") {
    return "image/gif";
  }
  if (buffer.subarray(0, 6).toString(TEXT_ENCODING) === "GIF89a") {
    return "image/gif";
  }

  if (
    buffer.subarray(0, 4).toString(TEXT_ENCODING) === "RIFF" &&
    buffer.subarray(8, 12).toString(TEXT_ENCODING) === "WEBP"
  ) {
    return "image/webp";
  }

  // BMP: "BM"
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }

  // TIFF: little- or big-endian magic
  const tiffLe = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
  const tiffBe = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
  if (
    buffer.subarray(0, 4).equals(tiffLe) ||
    buffer.subarray(0, 4).equals(tiffBe)
  ) {
    return "image/tiff";
  }

  // ISO base media (AVIF / HEIC): `....ftyp<brand>`
  if (buffer.subarray(4, 8).toString(TEXT_ENCODING) === "ftyp") {
    const brand = buffer.subarray(8, 12).toString(TEXT_ENCODING);
    if (brand.startsWith("avi")) {
      return "image/avif";
    }
    if (brand.startsWith("hei") || brand.startsWith("mif")) {
      return "image/heic";
    }
    return null;
  }

  // SVG is text, so look for the root element near the start.
  const head = buffer.subarray(0, SNIFF_BYTES).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return null;
}

/**
 * Decode a string that is *entirely* base64 and whose decoded head is a real
 * image. Returns null for anything URL-shaped (which always contains characters
 * outside the base64 alphabet) or for non-image data.
 */
export function decodeBase64Image(
  source: string
): { buffer: Buffer; mimeType: string } | null {
  const cleaned = source.replace(/\s+/g, "");

  // Too short to be an image, or not base64 at all (e.g. a URL has `:` or `.`).
  if (cleaned.length < 64 || cleaned.length % 4 !== 0) {
    return null;
  }
  if (!BASE64_ONLY.test(cleaned)) {
    return null;
  }

  const mimeType = sniffImageMime(Buffer.from(cleaned.slice(0, 64), "base64"));
  if (!mimeType) {
    return null;
  }

  const buffer = Buffer.from(cleaned, "base64");

  return buffer.length > 0 ? { buffer, mimeType } : null;
}
