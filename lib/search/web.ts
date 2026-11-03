import "server-only";

import { generateText } from "ai";

import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  type GroundingSource,
  getSearchModel,
  googleSearchTool,
  hasGrounding,
  today,
  toGroundingSources,
} from "@/lib/ai/search/grounding";
import { fetchPageText } from "@/lib/net/page";
import { duckDuckGoSearch } from "@/lib/search/duckduckgo";

/*
 * Searching the web, one way or another.
 *
 * Two paths, in order of quality:
 *
 * 1. **Grounded search.** Gemini runs the query itself and returns an answer
 *    with the pages it used. This is the best path: the citations are real and
 *    the synthesis already knows what the sources said.
 * 2. **Keyless search.** DuckDuckGo returns result links, the pages are read
 *    through the same address checks as every other fetch, and the chat model
 *    answers from that evidence. It is slower and plainer, but it needs no key
 *    and it is still reading real, current pages rather than remembering.
 *
 * The fallback exists because a search tool that answers from memory when its
 * key is exhausted is worse than one that says it is working differently.
 */

export type WebSearchResult = {
  answer: string;
  query: string;
  sources: GroundingSource[];
  /** Which path answered, so the caller can be honest about it. */
  via: "google" | "web";
};

/** How much of a page is worth carrying into the answer. */
const PAGE_CHARS = 6000;

/** How many result pages are read in the keyless path. */
const PAGES_TO_READ = 3;

/** The prompt both paths share. */
function searchPrompt(query: string): string {
  return [
    `Today is ${today()}.`,
    "Answer the question using the search results below.",
    "Prefer the most recent reliable sources, and say when a fact is time-sensitive or may have changed.",
    "Cite the sources you used with their links.",
    "If the results do not answer the question, say so plainly rather than guessing.",
    "",
    `QUESTION: ${query}`,
  ].join("\n");
}

/**
 * The keyless path: search, read the top pages, answer from them.
 */
async function keylessSearch(query: string): Promise<WebSearchResult> {
  const hits = await duckDuckGoSearch(query);

  if (hits.length === 0) {
    throw new Error(
      "The search returned no results. Try a broader or differently worded question."
    );
  }

  const pages = await Promise.all(
    hits.slice(0, PAGES_TO_READ).map(async (hit) => {
      try {
        const page = await fetchPageText(hit.url, { maxChars: PAGE_CHARS });

        return { ...hit, text: page.text };
      } catch {
        return { ...hit, text: "" };
      }
    })
  );

  const evidence = pages
    .map(
      (page, index) =>
        `[${index + 1}] ${page.title}\n${page.url}\n${
          page.text || page.snippet || "(page could not be read)"
        }`
    )
    .join("\n\n");

  const { text } = await generateText({
    model: getLanguageModel(DEFAULT_CHAT_MODEL),
    prompt: `${searchPrompt(query)}\n\nSEARCH RESULTS:\n${evidence}`,
  });

  return {
    answer: text,
    query,
    sources: hits.map((hit) => ({ title: hit.title, url: hit.url })),
    via: "web",
  };
}

/**
 * Searches the web, preferring the grounded path.
 *
 * A grounded call that fails for any reason — an exhausted key, a quota limit,
 * a transient error — falls through to the keyless path rather than surfacing a
 * provider error to the user.
 */
export async function searchWeb(query: string): Promise<WebSearchResult> {
  if (hasGrounding()) {
    try {
      const { sources, text } = await generateText({
        model: getSearchModel(),
        prompt: searchPrompt(query),
        tools: {
          google_search: googleSearchTool({ searchTypes: { webSearch: {} } }),
        },
      });

      const answer = text.trim();

      if (answer) {
        return {
          answer,
          query,
          sources: toGroundingSources(sources),
          via: "google",
        };
      }
    } catch (error) {
      console.warn("Grounded search failed, using the keyless search:", error);
    }
  }

  return await keylessSearch(query);
}
