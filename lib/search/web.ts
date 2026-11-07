import "server-only";

import { generateText } from "ai";

import {
  type GroundingSource,
  getSearchModel,
  today,
} from "@/lib/ai/search/grounding";
import { fetchPageText } from "@/lib/net/page";
import { searchProviders } from "@/lib/search/engines";

/*
 * Searching the web.
 *
 * There is no provider-executed search tool here: the app answers with Gemini
 * Flash, and a model asked to "search the web" without a tool answers from its
 * training data and invents the links — which is the one thing a search feature
 * must never do.
 *
 * So the search is done natively, in three steps:
 *
 * 1. **Find pages.** DuckDuckGo's HTML endpoint returns ordinary result links
 *    with no key and no account.
 * 2. **Read them.** The top pages are fetched through the address checks in
 *    `lib/net/page.ts`, which refuse anything that resolves into the
 *    deployment's own network.
 * 3. **Answer from them.** The model is given the page text and the question,
 *    and told to cite the URLs it used and to say when the evidence does not
 *    answer the question.
 *
 * The result is a real, current answer with real citations, from free models.
 */

export type WebSearchResult = {
  answer: string;
  query: string;
  sources: GroundingSource[];
  /** Which path answered, so the caller can be honest about it. */
  via: "web";
};

/** How much of a page is worth carrying into the answer. */
const PAGE_CHARS = 6000;

/** How many result pages are read. */
const PAGES_TO_READ = 3;

/** The prompt every search shares. */
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
 * Searches the web and answers from the pages it finds.
 */
export async function searchWeb(query: string): Promise<WebSearchResult> {
  const hits = await searchProviders(query);

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
    model: getSearchModel(),
    prompt: `${searchPrompt(query)}\n\nSEARCH RESULTS:\n${evidence}`,
  });

  return {
    answer: text,
    query,
    sources: hits.map((hit) => ({ title: hit.title, url: hit.url })),
    via: "web",
  };
}
