import "server-only";

import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { isTestEnvironment } from "@/lib/constants";

export type { GroundingSource } from "./sources";
export {
  isGroundingRedirect,
  sourceHost,
  sourceLabel,
  toGroundingSources,
} from "./sources";

/**
 * The grounded half of the app.
 *
 * The chat itself runs on OpenRouter, but *searching the web* is a capability
 * the provider has to have. OpenRouter models do not search: a plain
 * `generateText` call asking one to "search the web" answers from its training
 * data, which is the one thing a search tool must never do.
 *
 * Gemini does search — `google_search` is a provider-executed tool that returns
 * live results *and* the pages they came from. So grounding keeps its own
 * Gemini model, and only the grounded work goes through it:
 *
 * - web search and deep research,
 * - reading a URL,
 * - OCR (a vision task).
 *
 * Everything else stays on the chat model. This is not a second provider for
 * the sake of it: it is the one part of the pipeline that cannot be delegated
 * to a model without tools.
 */

/** The Gemini model that performs the grounded work. */
export const GROUNDING_MODEL_ID = "gemini-2.5-flash";

/** The Gemini model that reads images. */
export const VISION_MODEL_ID = "gemini-2.5-flash";

/**
 * Whether grounded work is available.
 *
 * Without a Gemini key the app still runs; the tools that need grounding say so
 * plainly rather than answering from memory and calling it a search.
 */
export function hasGrounding(): boolean {
  if (isTestEnvironment) {
    return false;
  }

  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

/**
 * The model that performs grounded reasoning, page synthesis and grounded
 * answers.
 */
export function getGroundingModel(): LanguageModel {
  if (hasGrounding()) {
    return google(GROUNDING_MODEL_ID) as unknown as LanguageModel;
  }

  return getLanguageModel(DEFAULT_CHAT_MODEL);
}

/** The model that searches the web. */
export function getSearchModel(): LanguageModel {
  return getGroundingModel();
}

/** The model that reads images. */
export function getVisionModel(): LanguageModel {
  if (hasGrounding()) {
    return google(VISION_MODEL_ID) as unknown as LanguageModel;
  }

  return getLanguageModel(DEFAULT_CHAT_MODEL);
}

/** The model id to report back to the user. */
export function groundingModelId(): string {
  return hasGrounding() ? GROUNDING_MODEL_ID : DEFAULT_CHAT_MODEL;
}

/** Today, as an ISO date, for prompts that ask for recent results. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type GoogleSearchArgs = {
  searchTypes?: {
    imageSearch?: Record<string, never>;
    webSearch?: Record<string, never>;
  };
  timeRangeFilter?: {
    startTime: string;
    endTime: string;
  };
};

/**
 * The provider-executed web search tool.
 *
 * Throws when grounding is not configured, because a caller that has not
 * checked is about to pretend to search. Every call site checks `hasGrounding()`
 * first and reports a clear message when it is false.
 */
export function googleSearchTool(args?: GoogleSearchArgs) {
  if (!hasGrounding()) {
    throw new Error(
      "Web search is not configured in this deployment. It needs a Google Generative AI key."
    );
  }

  return google.tools.googleSearch(args ?? {});
}

/**
 * The provider-executed URL-reading tool.
 *
 * Gemini reads the page itself, so script-rendered content, redirects and
 * pages behind a cookie are handled by the same mechanism that powers search.
 */
export function googleUrlContextTool() {
  if (!hasGrounding()) {
    throw new Error(
      "Reading pages with Google is not configured in this deployment."
    );
  }

  return google.tools.urlContext({});
}
