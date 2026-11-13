import type { ModelMessage } from "ai";

/**
 * Keeps the newest messages that fit the budget.
 *
 * A rough four-characters-per-token estimate is enough here: the goal is to stop
 * sending an unbounded chat history to a paid API, not to replace the model's
 * tokenizer. The latest message is always kept, even when it alone exceeds the
 * budget; dropping it would change the request.
 */
export function trimModelMessages(
  messages: ModelMessage[],
  maxInputTokens: number
): ModelMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const budgetChars = Math.max(1, maxInputTokens) * 4;
  const kept: ModelMessage[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const size = approximateChars(message);

    if (kept.length > 0 && used + size > budgetChars) {
      break;
    }

    kept.unshift(message);
    used += size;
  }

  if (kept.length === 0) {
    kept.push(messages.at(-1) as ModelMessage);
  }

  return kept;
}

function approximateChars(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return message.content.length;
  }

  if (Array.isArray(message.content)) {
    return message.content.reduce((total, part) => {
      if ("text" in part && typeof part.text === "string") {
        return total + part.text.length;
      }
      return total + 120;
    }, 0);
  }

  return 120;
}
