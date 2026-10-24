export const DEFAULT_CHAT_MODEL = "openrouter/free";

export const titleModel: {
  description: string;
  id: string;
  name: string;
  provider: string;
  gatewayOrder?: string[];
} = {
  description: "Fast free model for title generation",
  id: "openrouter/free",
  name: "Free Models Router",
  provider: "openrouter",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

/**
 * Curated list of high-quality free models on OpenRouter.
 * Google Gemini models are hidden from the selector per user configuration.
 */
export const chatModels: ChatModel[] = [
  {
    description:
      "Auto-routes to the best available free model with vision and tool use",
    id: "openrouter/free",
    name: "Free Models Router",
    provider: "openrouter",
  },
  {
    description:
      "Massive 120B parameter model with advanced reasoning and tool use (Free)",
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "NVIDIA Nemotron 3 Super 120B",
    provider: "nvidia",
    reasoningEffort: "medium",
  },
  {
    description:
      "31B parameter open-weights model with vision and tool use (Free)",
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B",
    provider: "gemma",
  },
  {
    description:
      "Specialized code generation and technical tool execution model (Free)",
    id: "cohere/north-mini-code:free",
    name: "Cohere North Mini Code",
    provider: "cohere",
  },
  {
    description: "Ultra-fast lightweight instruction model (Free)",
    id: "liquid/lfm-2.5-2.6b:free",
    name: "LiquidAI LFM 2.5",
    provider: "liquid",
  },
  {
    description:
      "512k context window with multimodal vision and tool use (Free)",
    id: "dots-studio/dots-3-note-preview:free",
    name: "Dots Studio Dots3",
    provider: "dots-studio",
  },
  {
    description:
      "1M token context reasoning model with multimodal capabilities (Free)",
    id: "thinkingmachines/inkling:free",
    name: "Thinking Machines Inkling",
    provider: "thinkingmachines",
    reasoningEffort: "medium",
  },
  {
    description:
      "Vision-language model with 1M context window and tool use (Free)",
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "NVIDIA Nemotron 3.5 Super VL",
    provider: "nvidia",
  },
];

export const modelCapabilitiesMap: Record<string, ModelCapabilities> = {
  "cohere/north-mini-code:free": {
    reasoning: true,
    tools: true,
    vision: false,
  },
  "dots-studio/dots-3-note-preview:free": {
    reasoning: true,
    tools: true,
    vision: true,
  },
  "google/gemma-4-31b-it:free": {
    reasoning: true,
    tools: true,
    vision: true,
  },
  "liquid/lfm-2.5-2.6b:free": {
    reasoning: false,
    tools: true,
    vision: false,
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    reasoning: true,
    tools: true,
    vision: false,
  },
  "nvidia/nemotron-3.5-super-vl:free": {
    reasoning: true,
    tools: true,
    vision: true,
  },
  "openrouter/free": { reasoning: true, tools: true, vision: true },
  "thinkingmachines/inkling:free": {
    reasoning: true,
    tools: true,
    vision: true,
  },
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
