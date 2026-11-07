import type { ChatMessage } from "@/lib/types";

/**
 * Tool-result continuity.
 *
 * The AI SDK refuses to call a model with a tool call that has no result:
 * `AI_MissingToolResultsError`. That is the right behaviour — a model cannot
 * continue a conversation with half a tool exchange — but it must never reach
 * the provider because of a client race, a stopped generation or a dropped
 * native callback. These helpers make the state complete before conversion.
 */

type LoosePart = {
  approval?: unknown;
  errorText?: string;
  input?: unknown;
  providerExecuted?: boolean;
  state?: string;
  toolCallId?: string;
  type: string;
};

const RESOLVED_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

const INTERRUPTED_MESSAGE =
  "The previous tool call was interrupted before it finished. Please try again.";

function isToolPart(part: unknown): part is LoosePart {
  return (
    Boolean(part) &&
    typeof (part as { type?: unknown }).type === "string" &&
    ((part as { type: string }).type.startsWith("tool-") ||
      (part as { type: string }).type === "dynamic-tool") &&
    typeof (part as { toolCallId?: unknown }).toolCallId === "string"
  );
}

function isResolved(part: LoosePart): boolean {
  return RESOLVED_STATES.has(part.state ?? "");
}

/**
 * Overlays tool results that exist only on the client onto the database copy.
 *
 * A client-side tool such as `deviceAction` is executed in the WebView. Its
 * result is written to the client's message state, but the database row still
 * has the original `input-available` call. Without this merge the continuation
 * loses the result and the model call fails with `AI_MissingToolResultsError`.
 */
export function mergeClientToolResults({
  clientMessages,
  dbMessages,
}: {
  clientMessages: ChatMessage[];
  dbMessages: ChatMessage[];
}): ChatMessage[] {
  const clientById = new Map(
    clientMessages.map((message) => [message.id, message])
  );

  return dbMessages.map((dbMessage) => {
    const clientMessage = clientById.get(dbMessage.id);

    if (!clientMessage) {
      return dbMessage;
    }

    const clientToolParts = new Map<string, LoosePart>(
      clientMessage.parts
        .map((part) => part as unknown as LoosePart)
        .filter(isToolPart)
        .filter(isResolved)
        .map((part) => [part.toolCallId as string, part])
    );

    if (clientToolParts.size === 0) {
      return dbMessage;
    }

    let changed = false;
    const parts = dbMessage.parts.map((part) => {
      const toolPart = part as unknown as LoosePart;

      if (!isToolPart(toolPart)) {
        return part;
      }

      const clientPart = clientToolParts.get(toolPart.toolCallId as string);
      if (!clientPart) {
        return part;
      }

      if (clientPart.state === toolPart.state) {
        return part;
      }

      changed = true;
      return clientPart as unknown as ChatMessage["parts"][number];
    });

    // A client-only tool result can exist for a call the database never saw
    // (for example, the assistant row was written without its later result).
    for (const [toolCallId, clientPart] of clientToolParts) {
      const exists = parts.some((part) => {
        const toolPart = part as unknown as LoosePart;
        return isToolPart(toolPart) && toolPart.toolCallId === toolCallId;
      });
      if (!exists) {
        parts.push(clientPart as unknown as ChatMessage["parts"][number]);
        changed = true;
      }
    }

    return changed ? ({ ...dbMessage, parts } as ChatMessage) : dbMessage;
  });
}

/**
 * Resolves every tool call that has no result.
 *
 * A synthetic `output-error` is the safest complete state: it is a real tool
 * result, it tells the model the action did not happen, and it does not invent
 * success. The returned messages are copies; the caller can persist them.
 */
export function resolveDanglingToolCalls(messages: ChatMessage[]): {
  messages: ChatMessage[];
  resolvedToolCallIds: string[];
} {
  const result = messages.map((message) => ({
    ...message,
    parts: [...message.parts],
  })) as ChatMessage[];

  const open = new Map<string, { messageIndex: number; partIndex: number }>();
  const resolvedToolCallIds: string[] = [];

  const resolveAll = () => {
    for (const [toolCallId, location] of open) {
      const part = result[location.messageIndex].parts[
        location.partIndex
      ] as unknown as LoosePart;

      result[location.messageIndex].parts[location.partIndex] = {
        ...part,
        approval: undefined,
        errorText: part.errorText || INTERRUPTED_MESSAGE,
        input: part.input ?? {},
        state: "output-error",
      } as unknown as ChatMessage["parts"][number];

      resolvedToolCallIds.push(toolCallId);
    }
    open.clear();
  };

  for (const [messageIndex, message] of result.entries()) {
    if (message.role === "user" || message.role === "system") {
      if (open.size > 0) {
        resolveAll();
      }
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    for (const [partIndex, rawPart] of message.parts.entries()) {
      const part = rawPart as unknown as LoosePart;

      if (!isToolPart(part)) {
        continue;
      }

      if (isResolved(part)) {
        open.delete(part.toolCallId as string);
      } else {
        open.set(part.toolCallId as string, { messageIndex, partIndex });
      }
    }
  }

  // The last assistant message can be the continuation itself: there is no
  // following user message to trigger the check, but the provider still needs
  // a result for every call.
  if (open.size > 0) {
    resolveAll();
  }

  return { messages: result, resolvedToolCallIds };
}
