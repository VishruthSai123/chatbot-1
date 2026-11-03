import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { customProvider, type LanguageModel } from "ai";

import { isTestEnvironment } from "../constants";
import { DEFAULT_CHAT_MODEL, titleModel, visionModel } from "./models";

/*
 * The model provider.
 *
 * Everything runs on OpenRouter. There is no second provider and no fallback
 * to one: a deployment without a key fails with a clear error rather than
 * silently answering from a different service.
 */

export function getOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  return createOpenRouter({
    apiKey: apiKey || "missing-key",
    headers: {
      "HTTP-Referer": "https://chatbot-1.vercel.app",
      "X-Title": "SuperiorAI",
    },
  });
}

// Proxied export so existing callers can use openrouter(modelId) directly
export const openrouter = new Proxy(
  ((..._args: unknown[]) => null) as unknown as ReturnType<
    typeof createOpenRouter
  >,
  {
    apply(_target, _thisArg, argArray) {
      const provider = getOpenRouterProvider();

      return (provider as unknown as (...args: unknown[]) => unknown)(
        ...argArray
      );
    },
    get(_target, prop) {
      const provider = getOpenRouterProvider();

      return (provider as unknown as Record<string, unknown>)[prop as string];
    },
  }
);

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");

      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

/**
 * Resolves a model id to a language model.
 *
 * An unknown id is passed through to OpenRouter rather than mapped to
 * something else, so a typo fails loudly instead of quietly using a different
 * model than the user chose.
 */
export function getLanguageModel(modelId?: string): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(
      modelId || "chat-model"
    ) as unknown as LanguageModel;
  }

  const provider = getOpenRouterProvider();

  return provider(modelId || DEFAULT_CHAT_MODEL) as unknown as LanguageModel;
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model") as unknown as LanguageModel;
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
  return getLanguageModel(visionModel.id);
}
