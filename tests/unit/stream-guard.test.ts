import { expect, test } from "@playwright/test";

import { withVisibleOutputGuard } from "../../lib/ai/stream-guard";

type Chunk = {
  delta?: string;
  error?: unknown;
  type: string;
};

function streamOf(chunks: Chunk[]): ReadableStream<Chunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  const reader = stream.getReader();

  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: test helper consumes in order
    const { done, value } = await reader.read();
    if (done) {
      return chunks;
    }
    chunks.push(value);
  }
}

test.describe("visible output guard", () => {
  test("injects an error before a finish with no visible content", async () => {
    const chunks = await collect(
      withVisibleOutputGuard(streamOf([{ type: "start" }, { type: "finish" }]))
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "error",
      "finish",
    ]);
    expect(chunks[1].error).toBeInstanceOf(Error);
  });

  test("does not inject an error when text was streamed", async () => {
    const chunks = await collect(
      withVisibleOutputGuard(
        streamOf([
          { type: "start" },
          { delta: "hello", type: "text-delta" },
          { type: "finish" },
        ])
      )
    );

    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
  });

  test("does not replace a provider error with a second error", async () => {
    const chunks = await collect(
      withVisibleOutputGuard(
        streamOf([{ error: new Error("provider failed"), type: "error" }])
      )
    );

    expect(chunks.filter((chunk) => chunk.type === "error")).toHaveLength(1);
  });
});
