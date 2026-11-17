// biome-ignore-all lint/performance/noAwaitInLoops: credential and provider attempts are sequential by design
import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";

import { isTestEnvironment } from "../constants";
import { readGoogleApiKeys } from "./api-keys";
import { shouldUseFallback } from "./fallback";
import { DEFAULT_CHAT_MODEL, titleModel, visionModel } from "./models";
import { errorStatusCode } from "./observability";

/*
 * The model provider.
 *
 * Gemini is the default and the only provider in the normal path. OpenRouter
 * exists only as an explicit, opt-in fallback for deployments that have
 * configured it; it is never selected silently, and it is never the default.
 *
 * Multiple Gemini keys are supported for rolling rotation. The first key is
 * primary; later keys are tried only after a retryable provider failure. This
 * keeps an invalid replacement key from taking down the last working one.
 */

export function getGoogleApiKeys(): string[] {
  return readGoogleApiKeys();
}

export function getGoogleApiKey(): string | undefined {
  return getGoogleApiKeys()[0];
}

export function isGoogleConfigured(): boolean {
  return getGoogleApiKeys().length > 0;
}

export function getGoogleProvider(
  apiKey: string | undefined = getGoogleApiKey()
) {
  if (!apiKey) {
    throw new Error(
      "Gemini is not configured. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY."
    );
  }

  return createGoogleGenerativeAI({
    apiKey,
    baseURL: process.env.GOOGLE_GENERATIVE_AI_API_BASE?.trim() || undefined,
  });
}

/**
 * OpenRouter is an opt-in fallback, not a second default.
 *
 * `AI_FALLBACK_PROVIDER=openrouter` plus `OPENROUTER_API_KEY` is the only way
 * it can be reached. The model is explicit so a deployment can point the
 * fallback at a cheap paid model or a known-good free one.
 */
export function isOpenRouterFallbackEnabled(): boolean {
  return (
    process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase() === "openrouter" &&
    Boolean(process.env.OPENROUTER_API_KEY?.trim())
  );
}

export function getOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "OpenRouter fallback is enabled but OPENROUTER_API_KEY is missing."
    );
  }

  return createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": "https://chatbot-1.vercel.app",
      "X-Title": "Spire",
    },
  });
}

export const myProvider =
  isTestEnvironment && process.env.NODE_ENV !== "production"
    ? (() => {
        const {
          chatModel,
          titleModel: mockTitleModel,
        } = require("./models.mock");

        return {
          chat: chatModel as LanguageModel,
          title: mockTitleModel as LanguageModel,
        };
      })()
    : null;

function logFallback(modelId: string, error: unknown) {
  console.warn(
    JSON.stringify({
      errorClass: (error as Error | undefined)?.name ?? "UnknownError",
      event: "ai_provider_fallback",
      from: "google",
      modelId,
      statusCode: errorStatusCode(error),
      to: "openrouter",
    })
  );
}

function logCredentialFallback(
  modelId: string,
  fromIndex: number,
  toIndex: number,
  error: unknown
) {
  console.warn(
    JSON.stringify({
      errorClass: (error as Error | undefined)?.name ?? "UnknownError",
      event: "ai_credential_fallback",
      fromCredential: fromIndex + 1,
      modelId,
      statusCode: errorStatusCode(error),
      toCredential: toIndex + 1,
    })
  );
}

function getFallbackModel(): LanguageModel | null {
  if (!isOpenRouterFallbackEnabled()) {
    return null;
  }

  const modelId =
    process.env.OPENROUTER_FALLBACK_MODEL?.trim() ||
    "google/gemini-3.5-flash-lite";

  return getOpenRouterProvider()(modelId) as unknown as LanguageModel;
}

/**
 * Tries the configured credentials in order and then the opt-in provider
 * fallback once. Only retryable provider failures advance to the next
 * credential; a bad request or an aborted stream does not.
 *
 * This is deliberately bounded: each key is attempted at most once and the
 * fallback provider at most once. There is no retry loop.
 */
function withCredentialFallback(
  candidates: LanguageModel[],
  fallback: LanguageModel | null,
  modelId: string
): LanguageModel {
  const [primary, ...rest] = candidates;

  if (!primary) {
    if (fallback) {
      return fallback;
    }
    throw new Error("No AI credential is configured.");
  }

  if (rest.length === 0 && !fallback) {
    return primary;
  }

  const additional = rest as unknown as LanguageModelV4[];
  const fallbackModel = fallback as unknown as LanguageModelV4 | null;

  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      let lastError: unknown;
      const attempts = [
        () => doGenerate(),
        ...additional.map((candidate) => () => candidate.doGenerate(params)),
      ];

      for (let index = 0; index < attempts.length; index += 1) {
        try {
          return await attempts[index]();
        } catch (error) {
          lastError = error;
          if (!shouldUseFallback(error)) {
            throw error;
          }
          if (index < attempts.length - 1) {
            logCredentialFallback(modelId, index, index + 1, error);
          }
        }
      }

      if (fallbackModel && shouldUseFallback(lastError)) {
        logFallback(modelId, lastError);
        return fallbackModel.doGenerate(params);
      }

      throw lastError ?? new Error("No AI provider is available.");
    },
    wrapStream: async ({ doStream, params }) => {
      let lastError: unknown;
      const attempts = [
        () => doStream(),
        ...additional.map((candidate) => () => candidate.doStream(params)),
      ];

      for (let index = 0; index < attempts.length; index += 1) {
        try {
          return await attempts[index]();
        } catch (error) {
          lastError = error;
          if (!shouldUseFallback(error)) {
            throw error;
          }
          if (index < attempts.length - 1) {
            logCredentialFallback(modelId, index, index + 1, error);
          }
        }
      }

      if (fallbackModel && shouldUseFallback(lastError)) {
        logFallback(modelId, lastError);
        return fallbackModel.doStream(params);
      }

      throw lastError ?? new Error("No AI provider is available.");
    },
  };

  return wrapLanguageModel({
    middleware,
    model: primary as Parameters<typeof wrapLanguageModel>[0]["model"],
  });
}

/**
 * Resolves a model id to a language model.
 *
 * The id is passed through unchanged, so an unknown id fails at the provider
 * with a clear message instead of quietly using a different model than the
 * user selected.
 */
export function getLanguageModel(modelId?: string): LanguageModel {
  const id = modelId || DEFAULT_CHAT_MODEL;

  if (process.env.NODE_ENV !== "production" && myProvider) {
    return myProvider.chat;
  }

  const keys = getGoogleApiKeys();
  const fallback = getFallbackModel();

  if (keys.length === 0) {
    if (fallback) {
      logFallback(id, new Error("Gemini API key is missing"));
      return fallback;
    }
    throw new Error(
      "Gemini is not configured. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY."
    );
  }

  const candidates = keys.map(
    (key) => getGoogleProvider(key)(id) as unknown as LanguageModel
  );

  return withCredentialFallback(candidates, fallback, id);
}

export function getTitleModel(): LanguageModel {
  if (process.env.NODE_ENV !== "production" && myProvider) {
    return myProvider.title;
  }

  return getLanguageModel(titleModel.id);
}

/**
 * The model that reads images.
 *
 * A separate id so a deployment can point OCR at a vision model without
 * changing the conversation's model.
 */
export function getVisionLanguageModel(): LanguageModel {
  if (process.env.NODE_ENV !== "production" && myProvider) {
    return myProvider.chat;
  }

  return getLanguageModel(visionModel.id);
}
