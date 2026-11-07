/**
 * One model, fixed at build time.
 *
 * Gemini 3.5 Flash-Lite is the low-cost current Gemini model that still
 * supports what this app needs: 1M context, image/PDF input, function calling
 * and streaming. There is deliberately no user-facing model selection.
 *
 * The id was checked against Google's `models` endpoint. Do not replace it
 * with a guessed alias.
 */

export type ModelProvider = "google" | "openrouter";

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  /** Gemini thinking level. `low` is the chat default. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

export const DEFAULT_CHAT_MODEL = "gemini-3.5-flash-lite";

/**
 * Title and vision use the same model. Title/OCR set thinking to `minimal`
 * explicitly because those tasks do not need reasoning.
 */
export const titleModel: {
  description: string;
  id: string;
  name: string;
  provider: ModelProvider;
} = {
  description: "Fast, low-cost title generation",
  id: DEFAULT_CHAT_MODEL,
  name: "Gemini 3.5 Flash-Lite",
  provider: "google",
};

export const visionModel: {
  description: string;
  id: string;
  name: string;
  provider: ModelProvider;
} = {
  description: "Fast, low-cost multimodal Gemini model for reading images",
  id: DEFAULT_CHAT_MODEL,
  name: "Gemini 3.5 Flash-Lite",
  provider: "google",
};

/** The only model in the app. */
export const chatModels: ChatModel[] = [
  {
    description:
      "Fast, low-cost Gemini with 1M context, vision and tool calling",
    id: DEFAULT_CHAT_MODEL,
    name: "Gemini 3.5 Flash-Lite",
    provider: "google",
    thinkingLevel: "low",
  },
];

export const modelCapabilitiesMap: Record<string, ModelCapabilities> = {
  "gemini-3.5-flash-lite": { reasoning: false, tools: true, vision: true },
};

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  return await Promise.resolve(modelCapabilitiesMap);
}

export const isDemo = process.env.IS_DEMO === "1";

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  return await Promise.resolve(
    chatModels.map((m) => ({
      ...m,
      capabilities: modelCapabilitiesMap[m.id] ?? {
        reasoning: false,
        tools: true,
        vision: false,
      },
    }))
  );
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);

export type ModelAvailability = "healthy" | "impacted" | "unknown";

export async function getModelAvailability(
  modelId: string
): Promise<ModelAvailability> {
  const model = chatModels.find((item) => item.id === modelId);

  if (!model) {
    return await Promise.resolve("unknown");
  }

  return await Promise.resolve("healthy");
}
