import { expect, test } from "@playwright/test";
import { convertToModelMessages, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  mergeClientToolResults,
  resolveDanglingToolCalls,
} from "../../lib/ai/tool-continuity";
import { isToolContinuation } from "../../lib/chat/message-state";
import type { ChatMessage } from "../../lib/types";

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};

const model = new MockLanguageModelV3({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { id: "t1", type: "text-start" as const },
        { delta: "ok", id: "t1", type: "text-delta" as const },
        { id: "t1", type: "text-end" as const },
        {
          finishReason: { raw: undefined, unified: "stop" as const },
          type: "finish" as const,
          usage,
        },
      ],
    }),
  }),
});

function assistantWithToolCall(
  state: "input-available" | "output-available",
  output?: { message: string; status: "ok" }
): ChatMessage {
  return {
    id: "assistant-1",
    parts: [
      {
        input: { action: "open_app", query: "Maps" },
        ...(output ? { output } : {}),
        state,
        toolCallId: "call-1",
        type: "tool-deviceAction",
      },
    ],
    role: "assistant",
  } as unknown as ChatMessage;
}

function userMessage(): ChatMessage {
  return {
    id: "user-2",
    parts: [{ text: "Thanks", type: "text" }],
    role: "user",
  } as unknown as ChatMessage;
}

test.describe("tool continuity", () => {
  test("a new user message after an earlier tool result is not a continuation", () => {
    expect(isToolContinuation([{ role: "assistant" }, { role: "user" }])).toBe(
      false
    );
    expect(isToolContinuation([{ role: "user" }, { role: "assistant" }])).toBe(
      true
    );
  });

  test("merges a client-side device result onto the database copy", () => {
    const merged = mergeClientToolResults({
      clientMessages: [
        assistantWithToolCall("output-available", {
          message: "Maps opened",
          status: "ok",
        }),
      ],
      dbMessages: [assistantWithToolCall("input-available")],
    });

    const part = merged[0].parts[0] as unknown as {
      output?: { message?: string };
      state?: string;
    };

    expect(part.state).toBe("output-available");
    expect(part.output?.message).toBe("Maps opened");
  });

  test("resolves a dangling call with exactly one synthetic result", () => {
    const { messages, resolvedToolCallIds } = resolveDanglingToolCalls([
      assistantWithToolCall("input-available"),
      userMessage(),
    ]);

    expect(resolvedToolCallIds).toEqual(["call-1"]);
    expect(messages[0].parts).toHaveLength(1);
    expect((messages[0].parts[0] as { state?: string }).state).toBe(
      "output-error"
    );
  });

  test("converts a repaired history without MissingToolResultsError", async () => {
    const { messages } = resolveDanglingToolCalls([
      assistantWithToolCall("input-available"),
      userMessage(),
    ]);
    const result = streamText({
      messages: await convertToModelMessages(messages),
      model,
    });

    await expect(result.text).resolves.toBe("ok");
  });
});
