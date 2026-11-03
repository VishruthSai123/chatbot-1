import "server-only";

import { assertPublicHost } from "@/lib/net/page";
import {
  parseDuckDuckGoResults,
  type SearchHit,
} from "@/lib/search/duckduckgo-parse";

/*
 * A keyless web search.
 *
 * The free models this app runs on cannot search — none of them has a search
 * tool — so the searching is done here instead of being delegated. DuckDuckGo's
 * HTML endpoint returns ordinary result links with no key and no account. It is
 * scraped defensively: a short timeout, a bounded number of results, and a plain
 * failure when it does not answer. The pages themselves are then read through
 * the same address checks as every other fetch.
 */

/** Where the keyless search lives. */
const SEARCH_URL = "https://html.duckduckgo.com/html/";

/** How long the search may take. */
const SEARCH_TIMEOUT_MS = 10_000;

/** The most results worth carrying forward. */
const MAX_RESULTS = 6;

export type { SearchHit } from "@/lib/search/duckduckgo-parse";

/**
 * Searches DuckDuckGo and returns the result links.
 *
 * Throws only when the search itself cannot be reached; an empty result set is
 * a normal outcome and returns an empty array.
 */
export async function duckDuckGoSearch(query: string): Promise<SearchHit[]> {
  const target = await assertPublicHost(SEARCH_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  let html: string;

  try {
    const response = await fetch(target, {
      body: new URLSearchParams({ q: query }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`The search answered with ${response.status}.`);
    }

    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  return parseDuckDuckGoResults(html, MAX_RESULTS);
}
