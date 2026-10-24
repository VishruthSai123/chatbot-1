import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { customProvider, type LanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { DEFAULT_CHAT_MODEL, titleModel } from "./models";

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
  ((..._args: unknown[]) => {
    // Proxy callable target placeholder
    return null;
  }) as unknown as ReturnType<typeof createOpenRouter>,
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

export function getLanguageModel(modelId?: string): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(
      modelId || "chat-model"
    ) as unknown as LanguageModel;
  }

  let targetId = modelId || DEFAULT_CHAT_MODEL;

  // Gracefully map any legacy model references to default OpenRouter model
  if (
    targetId.includes("gemini") ||
    targetId === "google/gemini-2.5-flash" ||
    targetId === "google/gemini-2.5-pro" ||
    targetId === "google/gemma-4-31b-it:free" ||
    targetId === "thinkingmachines/inkling:free" ||
    targetId === "nvidia/nemotron-3-super-120b-a12b:free"
  ) {
    targetId = DEFAULT_CHAT_MODEL;
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const provider = getOpenRouterProvider();
    return provider(targetId) as unknown as LanguageModel;
  }

  // Fallback to Google Gemini if OPENROUTER_API_KEY is not yet added to environment
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (geminiKey) {
    return google("gemini-2.5-flash") as unknown as LanguageModel;
  }

  const provider = getOpenRouterProvider();
  return provider(targetId) as unknown as LanguageModel;
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model") as unknown as LanguageModel;
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const provider = getOpenRouterProvider();
    return provider(titleModel.id) as unknown as LanguageModel;
  }

  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (geminiKey) {
    return google("gemini-2.5-flash") as unknown as LanguageModel;
  }

  const provider = getOpenRouterProvider();
  return provider(titleModel.id) as unknown as LanguageModel;
}
