import "server-only";

import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";

export type { GroundingSource } from "./sources";
export {
  isGroundingRedirect,
  sourceHost,
  sourceLabel,
  toGroundingSources,
} from "./sources";

/**
 * Grounded generation using OpenRouter models.
 */

/** The model used for grounded calls. */
export const GROUNDING_MODEL_ID = DEFAULT_CHAT_MODEL;

/**
 * The model that performs grounded reasoning, quizzes, deliverables, and page synthesis.
 */
export function getGroundingModel() {
  return getLanguageModel(GROUNDING_MODEL_ID);
}

/**
 * The model that performs online web search through OpenRouter.
 */
export function getSearchModel() {
  return getLanguageModel(GROUNDING_MODEL_ID);
}

/**
 * Compatibility stub for provider-defined search tool.
 */
export function googleSearchTool(_args?: {
  searchTypes?: {
    imageSearch?: Record<string, never>;
    webSearch?: Record<string, never>;
  };
}) {
  return undefined as any;
}

/**
 * Compatibility stub for provider-defined URL-reading tool.
 */
export function googleUrlContextTool() {
  return undefined as any;
}
