import "server-only";

import type { LanguageModel } from "ai";

import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel, getVisionLanguageModel } from "@/lib/ai/providers";

export type { GroundingSource } from "./sources";
export {
  isGroundingRedirect,
  sourceHost,
  sourceLabel,
  toGroundingSources,
} from "./sources";

/**
 * The models the non-chat work runs on.
 *
 * Everything in this app runs on OpenRouter. "Grounding" here does not mean a
 * provider-executed search tool — no such tool is used. It means the work that
 * turns *outside information* into text:
 *
 * - searching the web and reading the pages (done natively, see
 *   `lib/search/web.ts` and `lib/net/page.ts`),
 * - synthesising a research report,
 * - reading an image.
 *
 * Those tasks use the same provider as the chat; this module exists so the
 * choice lives in one place rather than at every call site.
 */

/** The model used for search synthesis, research and page reading. */
export function getGroundingModel(): LanguageModel {
  return getLanguageModel(DEFAULT_CHAT_MODEL);
}

/** The model used for search synthesis. */
export function getSearchModel(): LanguageModel {
  return getLanguageModel(DEFAULT_CHAT_MODEL);
}

/** The model that reads images. */
export function getVisionModel(): LanguageModel {
  return getVisionLanguageModel();
}

/** Today, as an ISO date, for prompts that ask for recent results. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
