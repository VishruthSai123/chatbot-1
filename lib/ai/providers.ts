import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { customProvider, type LanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { DEFAULT_CHAT_MODEL, titleModel } from "./models";

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://chatbot-1.vercel.app",
    "X-Title": "SuperiorAI",
  },
});

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

  // Gracefully map any legacy Gemini model references to default OpenRouter model
  if (
    targetId.includes("gemini") ||
    targetId === "google/gemini-2.5-flash" ||
    targetId === "google/gemini-2.5-pro"
  ) {
    targetId = DEFAULT_CHAT_MODEL;
  }

  return openrouter(targetId) as unknown as LanguageModel;
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model") as unknown as LanguageModel;
  }

  return openrouter(titleModel.id) as unknown as LanguageModel;
}
