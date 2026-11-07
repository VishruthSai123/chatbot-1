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
import { shouldUseFallback } from "./fallback";
import { DEFAULT_CHAT_MODEL, titleModel, visionModel } from "./models";
import { errorStatusCode } from "./observability";

/*
 * The model provider.
 *
 * Gemini is the default and the only provider in the normal path. OpenRouter
 * exists only as an explicit, opt-in fallback for deployments that have
 * configured it; it is never selected silently, and it is never the default.
 */

const GOOGLE_KEY_NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

export function getGoogleApiKey(): string | undefined {
  for (const name of GOOGLE_KEY_NAMES) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(getGoogleApiKey());
}

export function getGoogleProvider() {
  const apiKey = getGoogleApiKey();

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
 * Retries the *initial* provider call on the fallback model.
 *
 * Quota, auth and connection failures happen before the first stream chunk, so
 * this is enough to keep a deployment answering when Gemini is unavailable.
 * A failure after the stream has started is surfaced as an error part instead
 * of silently switching models mid-answer.
 */
function withFallback(
  primary: LanguageModel,
  fallback: LanguageModel | null,
  modelId: string
): LanguageModel {
  if (!fallback) {
    return primary;
  }

  const fallbackModel = fallback as unknown as LanguageModelV4;

  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate();
      } catch (error) {
        if (!shouldUseFallback(error)) {
          throw error;
        }
        logFallback(modelId, error);
        return fallbackModel.doGenerate(params);
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        return await doStream();
      } catch (error) {
        if (!shouldUseFallback(error)) {
          throw error;
        }
        logFallback(modelId, error);
        return fallbackModel.doStream(params);
      }
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

  const fallback = getFallbackModel();

  if (!isGoogleConfigured()) {
    if (fallback) {
      logFallback(id, new Error("Gemini API key is missing"));
      return fallback;
    }
    throw new Error(
      "Gemini is not configured. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY."
    );
  }

  const primary = getGoogleProvider()(id) as unknown as LanguageModel;

  return withFallback(primary, fallback, id);
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
