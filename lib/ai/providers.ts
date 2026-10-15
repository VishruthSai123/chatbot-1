import { google } from "@ai-sdk/google";
import { customProvider, gateway, type LanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

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

export function getLanguageModel(modelId: string): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId) as unknown as LanguageModel;
  }

  // If it's a Google Gemini model or starting with google/
  if (modelId.startsWith("google/") || modelId.startsWith("gemini")) {
    const cleanId = modelId.replace(/^google\//, "");
    return google(cleanId) as unknown as LanguageModel;
  }

  // Fallback to Vercel Gateway if gateway key is set
  if (process.env.AI_GATEWAY_API_KEY) {
    return gateway.languageModel(modelId) as unknown as LanguageModel;
  }

  // Default to Gemini 2.5 Flash
  return google("gemini-2.5-flash") as unknown as LanguageModel;
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model") as unknown as LanguageModel;
  }
  if (
    titleModel.id.startsWith("google/") ||
    titleModel.id.startsWith("gemini")
  ) {
    const cleanId = titleModel.id.replace(/^google\//, "");
    return google(cleanId) as unknown as LanguageModel;
  }
  return google("gemini-2.5-flash") as unknown as LanguageModel;
}
