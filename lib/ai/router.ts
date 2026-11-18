import type { PlanLimits } from "@/lib/entitlements";

export type RoutedModel = {
  id: string;
  /** Approximate input budget; the context builder enforces it. */
  maxInputTokens: number;
  maxOutputTokens: number;
};

export function modelRoutingEnabled(): boolean {
  return process.env.MODEL_ROUTING_ENABLED === "true";
}

/**
 * Routes the request to the cheapest model that can do the job.
 *
 * The UI still exposes one model. The router changes the server-side model for
 * free users, so the client contract stays stable while the free tier gets the
 * cheaper Flash-Lite lane.
 */
export function resolveChatModel(input: {
  plan: PlanLimits;
  requestedModel: string;
}): RoutedModel {
  if (input.plan.plan === "free") {
    return {
      id: "gemini-3.5-flash-lite",
      maxInputTokens: 4096,
      // 400 tokens truncates tool arguments such as a document body. The task
      // quota, not the output cap, is what keeps the free tier bounded.
      maxOutputTokens: 4096,
    };
  }

  if (input.plan.plan === "go" || input.plan.plan === "daypass") {
    return {
      id: "gemini-3.5-flash-lite",
      maxInputTokens: 8000,
      maxOutputTokens: 4096,
    };
  }

  return {
    id: input.requestedModel,
    maxInputTokens: 16_000,
    maxOutputTokens: 8192,
  };
}
