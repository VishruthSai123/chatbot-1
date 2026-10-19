/**
 * Byte-level container sniffing, shared by the server (Buffers) and the browser
 * (base64 decoded with `atob`).
 *
 * Deliberately free of Node APIs so both callers share one set of rules. There
 * are two failure modes this prevents, and both are silent:
 *
 *  - The server must not read JPEG base64 (`/9j/…`) as a root-relative path, or
 *    an edit aimed at the version on screen lands on the newest one instead.
 *  - The browser must not label every stored image `image/png`, or a download
 *    gets the wrong extension and a JPEG is offered as a PNG.
 */

/** Text encoding used to compare ASCII container markers. */
function marker(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

/** `\x89PNG\r\n\x1a\n` */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** TIFF, little- and big-endian. */
const TIFF_LE_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const;
const TIFF_BE_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const;

/** How many decoded bytes are enough to identify every supported container. */
const SNIFF_BYTES = 32;

/**
 * MIME type of an encoded image, or `null` when the bytes are not a container we
 * recognise. Never guesses: an unknown payload stays unknown.
 */
export function sniffImageBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (startsWith(bytes, PNG_MAGIC)) {
    return "image/png";
  }

  if (marker(bytes, 0, 6) === "GIF87a" || marker(bytes, 0, 6) === "GIF89a") {
    return "image/gif";
  }

  if (marker(bytes, 0, 4) === "RIFF" && marker(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }

  // BMP: "BM"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }

  if (startsWith(bytes, TIFF_LE_MAGIC) || startsWith(bytes, TIFF_BE_MAGIC)) {
    return "image/tiff";
  }

  // ISO base media (AVIF / HEIC): `....ftyp<brand>`
  if (marker(bytes, 4, 8) === "ftyp") {
    const brand = marker(bytes, 8, 12);
    if (brand.startsWith("avi")) {
      return "image/avif";
    }
    if (brand.startsWith("hei") || brand.startsWith("mif")) {
      return "image/heic";
    }
    return null;
  }

  // SVG is text, so look for the root element near the start.
  const head = marker(bytes, 0, SNIFF_BYTES).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return null;
}
