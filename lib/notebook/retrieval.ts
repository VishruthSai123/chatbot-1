import type { Bm25Hit } from "./bm25";
import { buildBm25Index } from "./bm25";
import type { NotebookChunk } from "./chunk";

/**
 * Choosing between "put it all in the prompt" and "search for the relevant bits".
 *
 * The two are not rivals. A model with the whole notebook in context answers
 * from it perfectly and never misses a passage. Retrieval is what you fall back
 * to when the notebook is too big for the context window — and it is strictly
 * worse, because it can miss the passage that held the answer.
 *
 * So the order matters: context first, retrieval second, and only when the size
 * genuinely demands it.
 */

/**
 * Roughly four characters per token.
 *
 * English averages a little under four characters per token including the
 * spaces; using four is the conventional estimate and errs towards the larger
 * side, which is the safe direction — it makes the fallback kick in sooner
 * rather than later.
 */
const CHARS_PER_TOKEN = 4;

/**
 * How much of the model's context a notebook may take.
 *
 * Gemini 2.5 Flash has a very large window, but the conversation around it
 * needs room too, and a notebook that fills the context leaves nothing for the
 * answer. A quarter of the window is generous for a notebook and leaves the
 * conversation plenty of space.
 */
const DEFAULT_TOKEN_BUDGET = 250_000;

/** How many passages to retrieve when the notebook is too big to fit. */
export const DEFAULT_RETRIEVAL_LIMIT = 12;

export type RetrievedPassage = {
  chunk: NotebookChunk;
  score: number;
};

export type RetrievalPlan =
  | {
      /** The whole notebook fits; the passages are the whole thing. */
      kind: "full";
      passages: NotebookChunk[];
      tokens: number;
    }
  | {
      /** The notebook is too big; only the relevant passages are used. */
      kind: "searched";
      passages: NotebookChunk[];
      tokens: number;
    };

/** Estimates how many tokens a piece of text costs. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Decides how to answer a question from a notebook.
 *
 * The rule is simple and deliberately blunt: if the notebook fits, use all of
 * it. Otherwise search, and return the passages that scored highest.
 */
export function planRetrieval({
  chunks,
  limit = DEFAULT_RETRIEVAL_LIMIT,
  query,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
}: {
  chunks: NotebookChunk[];
  /** The question, used for the search path. */
  query?: string;
  /** How many passages to retrieve on the search path. */
  limit?: number;
  tokenBudget?: number;
}): RetrievalPlan {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const tokens = estimateTokens("x".repeat(totalChars));

  if (tokens <= tokenBudget) {
    return { kind: "full", passages: chunks, tokens };
  }

  const index = buildBm25Index(
    chunks.map((chunk) => ({ id: chunk.id, text: chunk.text }))
  );

  const hits: Bm25Hit[] = query
    ? index.search(query, limit)
    : chunks.slice(0, limit).map((chunk) => ({ id: chunk.id, score: 0 }));

  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  const passages = hits
    .map((hit) => {
      const chunk = byId.get(hit.id);
      return chunk ? { chunk, score: hit.score } : null;
    })
    .filter((entry): entry is RetrievedPassage => entry !== null)
    // Keep the passages in reading order: a citation that jumps backwards
    // through the document is confusing to read.
    .sort((a, b) => a.chunk.index - b.chunk.index);

  return {
    kind: "searched",
    passages: passages.map((entry) => entry.chunk),
    tokens: passages.reduce(
      (sum, entry) => sum + estimateTokens(entry.chunk.text),
      0
    ),
  };
}
