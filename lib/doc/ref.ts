/*
 * How a document is addressed.
 *
 * Same convention as the other families: the file lives in Supabase Storage and
 * `Document.content` holds a small descriptor. A 300-page DOCX is a megabyte of
 * XML; keeping it in Postgres would mean copying it again for every version.
 *
 * The descriptor also carries the derived facts — the outline and the reading
 * statistics — so the studio can draw its chrome before it has parsed
 * anything.
 */

export type DocFormat = "docx" | "md" | "txt";

export type DocOutlineNode = {
  children: DocOutlineNode[];
  level: number;
  text: string;
};

export type DocStats = {
  characters: number;
  minutesToRead: number;
  minutesToSpeak: number;
  paragraphs: number;
  sentences: number;
  words: number;
};

export type DocRef = {
  /** The document's text, extracted. */
  text?: string;
  /** The heading tree. */
  outline?: DocOutlineNode[];
  filename?: string;
  format?: DocFormat;
  /** Reading statistics. */
  stats?: DocStats;
  storageKey: string;
  title?: string;
};

const DOC_REF_MARKER = "doc-ref:";

export function encodeDocRef(ref: DocRef): string {
  return `${DOC_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeDocRef(
  content: string | null | undefined
): DocRef | null {
  if (!content?.startsWith(DOC_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(DOC_REF_MARKER.length)) as DocRef;

    if (!parsed?.storageKey || typeof parsed.storageKey !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isDocRef(content: string | null | undefined): boolean {
  return decodeDocRef(content) !== null;
}
