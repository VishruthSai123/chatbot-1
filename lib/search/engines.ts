import "server-only";

import { assertPublicHost } from "@/lib/net/page";
import {
  parseDuckDuckGoLite,
  parseDuckDuckGoResults,
  type SearchHit,
} from "@/lib/search/duckduckgo-parse";

/*
 * Where results come from.
 *
 * A serverless function runs on a datacenter address, and the keyless engines
 * treat those with suspicion: DuckDuckGo answers 403 from many cloud ranges.
 * No amount of header-tuning fixes that, so there are two kinds of provider
 * here.
 *
 * - **Keyed providers** (Brave, Tavily) are the reliable ones. If either key is
 *   configured it is used first, because an API is designed to be called from a
 *   server.
 * - **Keyless providers** (DuckDuckGo HTML, then Lite) are tried when no key is
 *   configured. The two endpoints are blocked independently, so one can fail
 *   while the other answers.
 *
 * When every provider refuses, the error says why and what would fix it —
 * rather than surfacing a bare "403".
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** How long any single provider may take. */
const TIMEOUT_MS = 10_000;

/** The most results worth carrying forward. */
const MAX_RESULTS = 6;

export type { SearchHit } from "@/lib/search/duckduckgo-parse";

/** One provider's attempt, with the reason it failed when it did. */
type Attempt = {
  error?: string;
  hits: SearchHit[];
  name: string;
};

/** Fetches text with a timeout, through the shared address checks. */
async function fetchText(
  url: string,
  init?: RequestInit
): Promise<{ body: string; status: number }> {
  const target = await assertPublicHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      ...init,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });

    return { body: await response.text(), status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Brave Search.
 *
 * The free tier is generous enough for a chat app and the API is meant to be
 * called from a server, so this is the most reliable option.
 */
async function braveSearch(query: string, key: string): Promise<SearchHit[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");

  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("q", query);
  url.searchParams.set("safesearch", "moderate");

  const { body, status } = await fetchText(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });

  if (status !== 200) {
    throw new Error(`Brave answered ${status}.`);
  }

  const data = JSON.parse(body) as {
    web?: {
      results?: { description?: string; title?: string; url?: string }[];
    };
  };

  return (data.web?.results ?? [])
    .filter((result) => result.url)
    .slice(0, MAX_RESULTS)
    .map((result) => ({
      snippet: result.description ?? "",
      title: result.title ?? result.url ?? "",
      url: result.url as string,
    }));
}

/**
 * Tavily.
 *
 * Built for retrieval rather than for people, so it returns clean text with
 * each result.
 */
async function tavilySearch(query: string, key: string): Promise<SearchHit[]> {
  const { body, status } = await fetchText("https://api.tavily.com/search", {
    body: JSON.stringify({
      max_results: MAX_RESULTS,
      query,
      search_depth: "basic",
    }),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (status !== 200) {
    throw new Error(`Tavily answered ${status}.`);
  }

  const data = JSON.parse(body) as {
    results?: { content?: string; title?: string; url?: string }[];
  };

  return (data.results ?? [])
    .filter((result) => result.url)
    .slice(0, MAX_RESULTS)
    .map((result) => ({
      snippet: result.content?.slice(0, 500) ?? "",
      title: result.title ?? result.url ?? "",
      url: result.url as string,
    }));
}

/**
 * Serper.
 *
 * A Google Search API: it returns the organic results Google would have shown,
 * which is exactly the shape the rest of this file expects. It is built for
 * servers, so it does not care that the caller is a datacenter address.
 */
async function serperSearch(query: string, key: string): Promise<SearchHit[]> {
  const { body, status } = await fetchText("https://google.serper.dev/search", {
    body: JSON.stringify({ num: MAX_RESULTS, q: query }),
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
    },
    method: "POST",
  });

  if (status !== 200) {
    throw new Error(`Serper answered ${status}.`);
  }

  const data = JSON.parse(body) as {
    organic?: { link?: string; snippet?: string; title?: string }[];
  };

  return (data.organic ?? [])
    .filter((result) => result.link)
    .slice(0, MAX_RESULTS)
    .map((result) => ({
      snippet: result.snippet ?? "",
      title: result.title ?? result.link ?? "",
      url: result.link as string,
    }));
}

/** DuckDuckGo's full HTML endpoint. */
async function duckDuckGoHtml(query: string): Promise<SearchHit[]> {
  const { body, status } = await fetchText(
    "https://html.duckduckgo.com/html/",
    {
      body: new URLSearchParams({ q: query }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    }
  );

  if (status !== 200) {
    throw new Error(`DuckDuckGo answered ${status}.`);
  }

  return parseDuckDuckGoResults(body, MAX_RESULTS);
}

/** DuckDuckGo's Lite endpoint — blocked independently of the full one. */
async function duckDuckGoLite(query: string): Promise<SearchHit[]> {
  const url = new URL("https://lite.duckduckgo.com/lite/");

  url.searchParams.set("q", query);

  const { body, status } = await fetchText(url.toString());

  if (status !== 200) {
    throw new Error(`DuckDuckGo Lite answered ${status}.`);
  }

  return parseDuckDuckGoLite(body, MAX_RESULTS);
}

/**
 * Searches with the best available provider.
 *
 * Keyed providers come first because they are built for servers. The keyless
 * ones are tried in turn, and their failures are collected so the error can
 * explain what happened.
 */
export async function searchProviders(query: string): Promise<SearchHit[]> {
  const attempts: Attempt[] = [];

  const serperKey = process.env.SERPER_API_KEY?.trim();
  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();

  const providers: { name: string; run: () => Promise<SearchHit[]> }[] = [];

  if (serperKey) {
    providers.push({
      name: "Serper",
      run: () => serperSearch(query, serperKey),
    });
  }

  if (braveKey) {
    providers.push({
      name: "Brave",
      run: () => braveSearch(query, braveKey),
    });
  }

  if (tavilyKey) {
    providers.push({
      name: "Tavily",
      run: () => tavilySearch(query, tavilyKey),
    });
  }

  providers.push(
    { name: "DuckDuckGo", run: () => duckDuckGoHtml(query) },
    { name: "DuckDuckGo Lite", run: () => duckDuckGoLite(query) }
  );

  for (const provider of providers) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: providers are fallbacks for each other, so they must be tried in order and stop at the first that answers
      const hits = await provider.run();

      if (hits.length > 0) {
        return hits;
      }

      attempts.push({ error: "no results", hits, name: provider.name });
    } catch (error: any) {
      attempts.push({
        error: error?.message ?? "failed",
        hits: [],
        name: provider.name,
      });
    }
  }

  const blocked = attempts.every(
    (attempt) =>
      attempt.error === "no results" || /40[13]|429/.test(attempt.error ?? "")
  );

  throw new Error(
    blocked
      ? "Search is blocked from this server's address. Add a SERPER_API_KEY (or BRAVE_SEARCH_API_KEY / TAVILY_API_KEY) to enable reliable search."
      : `Search failed: ${attempts
          .map((attempt) => `${attempt.name} (${attempt.error})`)
          .join(", ")}`
  );
}
