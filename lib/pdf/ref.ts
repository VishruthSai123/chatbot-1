import "server-only";

/**
 * How a PDF version is addressed.
 *
 * Images inline their bytes into `Document.content` as base64. PDFs cannot: a
 * single 20-page scan is routinely 5–30 MB, base64 inflates it by a third, and
 * every edit would copy the whole thing into Postgres again. They live in
 * Supabase Storage instead, and `Document.content` holds this small envelope.
 *
 * The envelope exists rather than a bare storage key because a version also has to
 * answer "how many pages" and "how big" without downloading the file — the studio
 * needs both to lay out its grid before the first byte arrives.
 */
export type PdfRef = {
  storageKey: string;
  /** Page count at the time this version was written. Advisory, not trusted. */
  pages?: number;
  /** Byte size at the time this version was written. Advisory. */
  bytes?: number;
  filename?: string;
};

/** Marks a `Document.content` string as a PDF envelope rather than prose. */
const PDF_REF_MARKER = "pdf-ref:";

export function encodePdfRef(ref: PdfRef): string {
  return `${PDF_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodePdfRef(
  content: string | null | undefined
): PdfRef | null {
  if (!content?.startsWith(PDF_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(PDF_REF_MARKER.length)) as PdfRef;

    if (!parsed?.storageKey || typeof parsed.storageKey !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isPdfRef(content: string | null | undefined): boolean {
  return decodePdfRef(content) !== null;
}

/** Envelope carried in the UI stream so the client can mount the studio. */
export type PdfPayload = PdfRef & {
  documentId: string;
  title: string;
};
