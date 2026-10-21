import { tokenize } from "./chunk";

/**
 * A BM25 index over a notebook's passages.
 *
 * Why BM25 and not embeddings:
 *
 * - It needs no infrastructure. No vector store, no extension to enable, no
 *   embedding bill, nothing to keep running.
 * - It is exact. A question about "the 2024 revenue figure" should find the
 *   passage containing that figure, not a passage that is semantically nearby
 *   but numerically different. Embeddings blur exactly the numbers and names
 *   that matter most in a spreadsheet or a report.
 * - It is instant. An index over a few hundred passages builds in milliseconds.
 *
 * The plan is progressive: a notebook that fits in the model's context is put
 * there whole, and BM25 is the fallback for the ones that do not. When a
 * notebook is big enough that BM25's recall actually shows, a hybrid with
 * embeddings is the next step — not the first.
 */

/** BM25 term-frequency saturation. The standard value. */
const K1 = 1.5;

/** BM25 length normalisation. The standard value. */
const B = 0.75;

export type Bm25Document = {
  id: string;
  text: string;
};

export type Bm25Hit = {
  id: string;
  score: number;
};

export type Bm25Index = {
  /** The ranked passages for a query. */
  search: (query: string, limit?: number) => Bm25Hit[];
  /** How many passages the index holds. */
  size: number;
};

type Posting = {
  /** Term frequency within the document. */
  frequency: number;
};

/**
 * Builds a BM25 index over the given passages.
 *
 * A passage with no indexable words is kept in the corpus (so ids stay
 * resolvable) but contributes no postings, which means it can never match.
 */
export function buildBm25Index(documents: Bm25Document[]): Bm25Index {
  const postings = new Map<string, Map<string, Posting>>();
  const lengths = new Map<string, number>();
  const ids: string[] = [];
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    const { id, text } = document;
    const tokens = tokenize(text);

    ids.push(id);
    lengths.set(id, tokens.length);

    const counts = new Map<string, number>();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    for (const [term, frequency] of counts) {
      let termPostings = postings.get(term);

      if (!termPostings) {
        termPostings = new Map<string, Posting>();
        postings.set(term, termPostings);
      }

      termPostings.set(id, { frequency });
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = documents.length;
  const averageLength =
    lengths.size > 0
      ? Array.from(lengths.values()).reduce((sum, length) => sum + length, 0) /
        lengths.size
      : 0;

  const search = (query: string, limit = 8): Bm25Hit[] => {
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0 || total === 0) {
      return [];
    }

    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const termPostings = postings.get(term);

      if (!termPostings) {
        continue;
      }

      const frequency = documentFrequency.get(term) ?? 0;

      // The smoothed IDF: always positive, so a term that appears in every
      // passage contributes a small amount rather than a negative score.
      const idf = Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));

      for (const [id, posting] of termPostings) {
        const length = lengths.get(id) ?? 0;

        const denominator =
          posting.frequency +
          K1 * (1 - B + (B * length) / (averageLength || 1));

        const score =
          idf * ((posting.frequency * (K1 + 1)) / (denominator || 1));

        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  };

  return { search, size: documents.length };
}
