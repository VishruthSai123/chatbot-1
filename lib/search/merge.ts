import type { SearchSource } from "./ref";

/**
 * Merges source lists without duplicates.
 *
 * A research run often includes the same pages a preceding web search already
 * returned. Keeping the first occurrence preserves the order the model used,
 * which is the order the citations refer to.
 */
export function mergeSearchSources(
  ...groups: Array<SearchSource[] | undefined>
): SearchSource[] {
  const seen = new Set<string>();
  const merged: SearchSource[] = [];

  for (const group of groups) {
    for (const source of group ?? []) {
      const url = source?.url?.trim();

      if (!url || seen.has(url)) {
        continue;
      }

      seen.add(url);
      merged.push({
        title: source.title?.trim() || undefined,
        url,
      });
    }
  }

  return merged;
}
