/**
 * A model stream must never reach the UI with nothing in it.
 *
 * Some providers end a turn with only `start` / `finish` — a safety stop, an
 * empty candidate, or a reasoning-only response whose reasoning is not being
 * forwarded. The client then renders an empty assistant message, which looks
 * like a broken app. This transform injects an explicit error part before the
 * finish chunk so the turn always has a visible outcome.
 */

type ModelChunk = {
  delta?: string;
  error?: unknown;
  type: string;
};

function isVisible(chunk: ModelChunk): boolean {
  if (chunk.type === "text-delta") {
    return Boolean(chunk.delta?.trim());
  }

  return chunk.type === "tool-call" || chunk.type === "tool-input-start";
}

export function withVisibleOutputGuard<T extends ModelChunk>(
  stream: ReadableStream<T>
): ReadableStream<T> {
  const reader = stream.getReader();

  return new ReadableStream<T>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      let visible = false;
      let sawError = false;

      while (true) {
        // biome-ignore lint/performance/noAwaitInLoops: chunks are consumed in order
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        if (isVisible(value)) {
          visible = true;
        } else if (value.type === "error") {
          sawError = true;

          // A provider can emit a late error after the answer has already
          // streamed. Do not replace a visible answer with an error card.
          if (visible) {
            continue;
          }
        }

        if (value.type === "finish" && !visible && !sawError) {
          controller.enqueue({
            error: new Error(
              "The model returned no output. Please retry or switch models."
            ),
            type: "error",
          } as T);
        }

        controller.enqueue(value);
      }
    },
  });
}
