/**
 * Chunking a source into retrievable passages.
 *
 * Pure, so the rules can be tested directly. The shape of a chunk matters more
 * than it looks: it is what a citation points at, so a chunk has to be small
 * enough to quote and large enough to answer from.
 */

/** A retrievable passage from a source. */
export type NotebookChunk = {
  /** Stable id, unique within a notebook. */
  id: string;
  /** Position in the source, used to keep chunks in reading order. */
  index: number;
  /** Where in the source this came from — "Page 4", "Introduction". */
  label?: string;
  text: string;
};

/** Roughly the target size of a chunk, in characters. */
const DEFAULT_MAX_CHARS = 1200;

/** How much of the previous chunk is repeated, so a split sentence is still findable. */
const DEFAULT_OVERLAP = 150;

/** Below this, a token is not worth indexing. */
const MIN_TOKEN_LENGTH = 2;

/**
 * Words that match almost everything and so tell a ranking algorithm nothing.
 *
 * A short list on purpose: an aggressive stopword list is a common source of
 * "why can't it find that phrase" bugs.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Splits text into words for indexing.
 *
 * Numbers are kept, and a leading or trailing hyphen is dropped so "well-known"
 * and "well known" index the same way.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter(
      (token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token)
    );
}

/**
 * Breaks a long paragraph at a sentence boundary.
 *
 * Text without sentence punctuation (a table, a URL list) falls back to a hard
 * split, because a chunk that is too long is merely unhelpful whereas a chunk
 * that drops text is wrong.
 */
function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      pieces.push(current.trim());
      current = "";
    }

    if (sentence.length > maxChars) {
      // A single sentence longer than the limit: cut it on word boundaries.
      let rest = sentence;

      while (rest.length > maxChars) {
        const cut = rest.lastIndexOf(" ", maxChars);
        const piece = cut > 0 ? rest.slice(0, cut) : rest.slice(0, maxChars);
        pieces.push(piece.trim());
        rest = rest.slice(piece.length);
      }

      current = rest;
      continue;
    }

    current += sentence;
  }

  if (current.trim()) {
    pieces.push(current.trim());
  }

  return pieces;
}

/**
 * Chunks a piece of text into passages.
 *
 * Paragraphs are kept whole wherever possible, because a paragraph is the
 * smallest unit that usually makes sense to quote, and a chunk that ends
 * mid-thought reads badly when it is cited.
 */
export function chunkText({
  label,
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP,
  startIndex = 0,
  text,
}: {
  /** Where this text came from, recorded on every chunk it produces. */
  label?: string;
  maxChars?: number;
  overlap?: number;
  /** The index of the first chunk, so chunks across a source stay ordered. */
  startIndex?: number;
  text: string;
}): NotebookChunk[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();

  if (!cleaned) {
    return [];
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const pieces: string[] = [];

  for (const paragraph of paragraphs) {
    for (const piece of splitLongParagraph(paragraph, maxChars)) {
      if (piece) {
        pieces.push(piece);
      }
    }
  }

  // Greedily pack consecutive pieces up to the limit.
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }

    current = current ? `${current}\n\n${piece}` : piece;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.map((chunk, index) => {
    const chunkIndex = startIndex + index;

    return {
      id: `chunk-${chunkIndex}`,
      index: chunkIndex,
      label,
      text:
        overlap > 0 && index > 0
          ? `${chunks[index - 1].slice(-overlap)}\n${chunk}`.trim()
          : chunk,
    };
  });
}

/**
 * The number of chunks a text would produce, without producing them.
 *
 * The retrieval budget needs to know a notebook's size before deciding whether
 * to put it in context, and chunking a hundred-megabyte notebook just to count
 * it would be wasteful.
 */
export function estimateChunkCount(
  text: string,
  maxChars = DEFAULT_MAX_CHARS
): number {
  if (!text.trim()) {
    return 0;
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  let count = 0;
  let current = 0;

  for (const paragraph of paragraphs) {
    const pieces = splitLongParagraph(paragraph, maxChars);

    for (const piece of pieces) {
      if (current && current + piece.length + 1 > maxChars) {
        count += 1;
        current = 0;
      }

      current += piece.length + 1;
    }
  }

  if (current > 0) {
    count += 1;
  }

  return count;
}
