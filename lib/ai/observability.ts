/**
 * Structured, privacy-safe chat telemetry.
 *
 * Only routing and timing metadata is logged. Prompts, messages, attachment
 * names and file contents never reach this module.
 */

export type ChatObservation = {
  errorClass?: string;
  finishReason?: string;
  firstTokenMs?: number;
  modelId?: string;
  provider?: string;
  requestId?: string;
  statusCode?: number;
  toolCallCount?: number;
  totalMs?: number;
  userType?: string;
};

export function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return "UnknownError";
}

export function errorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return;
  }

  const value = error as {
    cause?: unknown;
    data?: { status?: string };
    statusCode?: number;
  };

  if (typeof value.statusCode === "number") {
    return value.statusCode;
  }

  return errorStatusCode(value.cause);
}

/** A stable provider label for a model id. */
export function providerForModel(modelId: string): string {
  if (modelId.startsWith("openrouter/") || modelId.includes(":free")) {
    return "openrouter";
  }
  if (modelId.startsWith("google/")) {
    return "google";
  }
  return "google";
}

/**
 * Writes one JSON line. `undefined` values are dropped so a log line never
 * contains a key with no useful value.
 */
export function logChatObservation(
  event: string,
  observation: ChatObservation
): void {
  const payload: Record<string, unknown> = {
    event,
    timestamp: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(observation)) {
    if (value !== undefined && value !== null) {
      payload[key] = value;
    }
  }

  console.info(JSON.stringify(payload));
}
