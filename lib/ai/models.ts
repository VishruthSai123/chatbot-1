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
      "Vision-language model with 1M context window and tool use (Free)",
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "NVIDIA Nemotron 3.5 Super VL",
    provider: "nvidia",
  },
  {
    description:
      "High-speed 1M token context instruction model with tool use (Free)",
    id: "nvidia/nemotron-3.5-lightning:free",
    name: "NVIDIA Nemotron 3.5 Lightning",
    provider: "nvidia",
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
      "262k context reasoning and versatile instruction model (Free)",
    id: "poolside/laguna-s-2.1:free",
    name: "Poolside Laguna S 2.1",
    provider: "poolside",
    reasoningEffort: "medium",
  },
  {
    description: "Fast 262k context general instruction and tool model (Free)",
    id: "recursive/flint-v1.0:free",
    name: "Recursive Flint",
    provider: "recursive",
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
  "liquid/lfm-2.5-2.6b:free": {
    reasoning: false,
    tools: true,
    vision: false,
  },
  "nvidia/nemotron-3.5-lightning:free": {
    reasoning: false,
    tools: true,
    vision: false,
  },
  "nvidia/nemotron-3.5-super-vl:free": {
    reasoning: true,
    tools: true,
    vision: true,
  },
  "openrouter/free": { reasoning: true, tools: true, vision: true },
  "poolside/laguna-s-2.1:free": {
    reasoning: true,
    tools: true,
    vision: false,
  },
  "recursive/flint-v1.0:free": {
    reasoning: false,
    tools: true,
    vision: false,
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
