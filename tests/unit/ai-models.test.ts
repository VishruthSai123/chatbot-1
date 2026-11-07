import { expect, test } from "@playwright/test";

import { shouldUseFallback } from "../../lib/ai/fallback";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  modelCapabilitiesMap,
  titleModel,
  visionModel,
} from "../../lib/ai/models";
import { providerForModel } from "../../lib/ai/observability";

test.describe("model configuration", () => {
  test("defaults chat, title and vision to Gemini 3.5 Flash-Lite", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("gemini-3.5-flash-lite");
    expect(visionModel.id).toBe("gemini-3.5-flash-lite");
    expect(titleModel.id).toBe("gemini-3.5-flash-lite");
  });

  test("only one model is available", () => {
    expect(chatModels).toHaveLength(1);
    expect(chatModels.every((model) => model.provider === "google")).toBe(true);
    expect(allowedModelIds.has(DEFAULT_CHAT_MODEL)).toBe(true);
    expect(allowedModelIds.has("openrouter/free")).toBe(false);
  });

  test("the default model advertises tools and vision", () => {
    expect(modelCapabilitiesMap[DEFAULT_CHAT_MODEL]).toEqual({
      reasoning: false,
      tools: true,
      vision: true,
    });
  });

  test("provider labels distinguish the explicit fallback", () => {
    expect(providerForModel("gemini-3.5-flash-lite")).toBe("google");
    expect(providerForModel("openrouter/free")).toBe("openrouter");
  });
});

test.describe("provider fallback policy", () => {
  test("falls back for quota and auth failures", () => {
    expect(shouldUseFallback({ statusCode: 402 })).toBe(true);
    expect(shouldUseFallback({ statusCode: 401 })).toBe(true);
    expect(shouldUseFallback({ statusCode: 429 })).toBe(true);
  });

  test("does not hide a malformed request or an abort", () => {
    expect(shouldUseFallback({ statusCode: 400 })).toBe(false);

    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(shouldUseFallback(abort)).toBe(false);
  });
});
