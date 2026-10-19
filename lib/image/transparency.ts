/**
 * Client-side transparency probe.
 *
 * The studio stores bare base64 without any metadata, so "does this image have a
 * transparent background?" can only be answered by looking at the pixels. The
 * answer drives the format defaults (a cutout should not be offered JPEG first)
 * and the confirmation shown when an action cannot keep transparency.
 *
 * The image is drawn into a small canvas first: downscaling keeps the check cheap
 * for a full-resolution photo while any region with partial or zero alpha still
 * paints a translucent pixel, which is all this needs to know.
 */

import { imageSrcToDataUrl } from "@/lib/image/mime";

/** Pixel alpha at or above this counts as fully opaque. */
const OPAQUE_ALPHA = 250;

/** Longest edge of the probe canvas. */
const PROBE_EDGE = 160;

/** Verdicts are memoised: the probe runs on every image version change. */
const verdicts = new Map<string, boolean>();

/**
 * Cheap identity for a (possibly multi-megabyte) base64 payload: length plus both
 * ends is enough to tell consecutive image versions apart, and unlike the full
 * string it cannot pin megabytes of memory per entry.
 */
function fingerprint(src: string): string {
  return `${src.length}:${src.slice(0, 24)}:${src.slice(-24)}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function probe(src: string): Promise<boolean> {
  const image = await loadImage(imageSrcToDataUrl(src));
  if (!(image?.naturalWidth && image.naturalHeight)) {
    return false;
  }

  const scale = Math.min(
    1,
    PROBE_EDGE / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return false;
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const { data } = context.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < OPAQUE_ALPHA) {
        return true;
      }
    }
    return false;
  } catch {
    // A canvas that cannot be read (tainted or unsupported) must never block a
    // tool call; treat it as opaque.
    return false;
  }
}

/** Whether the image has any pixel that is not fully opaque. */
export async function imageHasTransparency(src: string): Promise<boolean> {
  if (!src) {
    return false;
  }

  const key = fingerprint(src);
  const cached = verdicts.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const verdict = await probe(src);
  verdicts.set(key, verdict);
  return verdict;
}
