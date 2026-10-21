import "server-only";

import { google } from "@ai-sdk/google";

export type { GroundingSource } from "./sources";
export {
  isGroundingRedirect,
  sourceHost,
  sourceLabel,
  toGroundingSources,
} from "./sources";

/**
 * Grounded generation with Gemini's built-in tools.
 *
 * Gemini 2 models can search the web and read a URL *inside the model call*.
 * That is worth being precise about, because it changes what this app needs:
 *
 * - **Web search** (`googleSearch`) is not a search API we have to call, parse,
 *   rank and pay for. Gemini does the retrieval and returns the pages it used as
 *   `sources`, which become citations.
 * - **URL reading** (`urlContext`) means a page can be summarised without us
 *   writing a fetcher, a readability parser or a headless browser.
 *
 * Both are Gemini-2-only, which is why the tools below always use a Gemini
 * model internally rather than the user's selected model: a search tool that
 * silently stops working when the user picks a different model would be a trap.
 * The answer is written by the *user's* model afterwards, so the voice still
 * matches what they chose.
 */

/** The model used for grounded calls. */
export const GROUNDING_MODEL_ID = "gemini-2.5-flash";

/**
 * The model that performs searches and page reads.
 *
 * Always Gemini, never the user's choice: grounding is a Gemini 2 feature, and
 * a search that only works for some users would be worse than one that is
 * consistently available.
 */
export function getGroundingModel() {
  return google(GROUNDING_MODEL_ID) as unknown as ReturnType<typeof google>;
}

/**
 * The provider-defined search tool.
 *
 * The tool *name* matters: the provider matches on `"google_search"`, so the key
 * in the tools record is part of the contract, not a label.
 */
export function googleSearchTool(args?: {
  searchTypes?: {
    imageSearch?: Record<string, never>;
    webSearch?: Record<string, never>;
  };
}) {
  return google.tools.googleSearch(args ?? {});
}

/** The provider-defined URL-reading tool. */
export function googleUrlContextTool() {
  return google.tools.urlContext({});
}
