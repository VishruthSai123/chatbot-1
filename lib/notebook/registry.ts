import "server-only";

import type { NotebookChunk } from "./chunk";

/**
 * A cache of extracted source text.
 *
 * Reading a source is expensive — a PDF is parsed page by page, an image goes
 * through OCR, a web page is fetched and read by a model. A notebook is asked
 * several questions in a row, and the sources do not change between them, so
 * without a cache every question would re-read every source.
 *
 * The cache is in memory, so it lives as long as the function instance. On
 * serverless that means it is a bonus, not a guarantee: a cold start simply
 * re-reads. That is the right trade for a cache that is only an optimisation
 * and never a source of truth.
 */

type CacheEntry = {
  chunks: NotebookChunk[];
  expiresAt: number;
};

/** How long an extracted source stays cached. */
const TTL_MS = 60 * 60 * 1000;

/** How many sources are kept before the oldest is dropped. */
const MAX_ENTRIES = 60;

const cache = new Map<string, CacheEntry>();

/** The key a source is cached under. */
export function sourceCacheKey(source: {
  documentId?: string;
  storageKey?: string;
  url?: string;
}): string {
  return source.storageKey ?? source.url ?? source.documentId ?? "unknown";
}

export function getCachedChunks(key: string): NotebookChunk[] | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  // Refresh the position so the eviction below drops the genuinely old entries.
  cache.delete(key);
  cache.set(key, entry);

  return entry.chunks;
}

export function setCachedChunks(key: string, chunks: NotebookChunk[]): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();

    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }

  cache.set(key, { chunks, expiresAt: Date.now() + TTL_MS });
}

/** Drops every cached source. Used by the tests. */
export function clearNotebookCache(): void {
  cache.clear();
}
