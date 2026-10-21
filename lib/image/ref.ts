/**
 * How an image version is addressed.
 *
 * Historically, images inlined their bytes into `Document.content` as bare base64.
 * This caused severe payload bloat (e.g. 5 MB rows in Postgres, Vercel 4.5 MB limits,
 * and slow multi-image transfers).
 *
 * Moving to Supabase Storage mirrors the PDF Studio architecture:
 * The image bytes live in the private storage bucket, and `Document.content` holds
 * this lightweight metadata envelope.
 */
export type ImageRef = {
  filename?: string;
  format?: string;
  height?: number;
  sizeBytes?: number;
  storageKey: string;
  thumbKey?: string;
  thumbUrl?: string;
  url?: string;
  width?: number;
};

/** Marks a `Document.content` string as a single image envelope. */
export const IMAGE_REF_MARKER = "image-ref:";

export function encodeImageRef(ref: ImageRef): string {
  return `${IMAGE_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeImageRef(
  content: string | null | undefined
): ImageRef | null {
  if (!content?.startsWith(IMAGE_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(IMAGE_REF_MARKER.length)
    ) as ImageRef;
    if (!parsed?.storageKey || typeof parsed.storageKey !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isImageRef(content: string | null | undefined): boolean {
  return decodeImageRef(content) !== null;
}

/**
 * How an image collection (multi-image album / project) is addressed.
 *
 * Contains an array of item descriptors and the currently active item ID.
 */
export type ImageCollectionItem = {
  documentId: string;
  filename?: string;
  format?: string;
  height?: number;
  sizeBytes?: number;
  storageKey: string;
  thumbKey?: string;
  thumbUrl?: string;
  title?: string;
  url?: string;
  width?: number;
};

export type ImageCollectionRef = {
  activeId?: string;
  items: ImageCollectionItem[];
  title?: string;
};

/** Marks a `Document.content` string as an image collection envelope. */
export const IMAGE_COLLECTION_MARKER = "image-collection:";

export function encodeImageCollection(ref: ImageCollectionRef): string {
  return `${IMAGE_COLLECTION_MARKER}${JSON.stringify(ref)}`;
}

export function decodeImageCollection(
  content: string | null | undefined
): ImageCollectionRef | null {
  if (!content?.startsWith(IMAGE_COLLECTION_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(IMAGE_COLLECTION_MARKER.length)
    ) as ImageCollectionRef;
    if (!parsed || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isImageCollection(content: string | null | undefined): boolean {
  return decodeImageCollection(content) !== null;
}
