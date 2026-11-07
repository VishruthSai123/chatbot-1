import { expect, test } from "@playwright/test";
import { MockLanguageModelV3 } from "ai/test";

import { runOcr } from "../../lib/image/ocr-core";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=",
  "base64"
);
const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64"
);

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 3, total: 3 },
};

function modelReturning(text: string, capture?: (prompt: unknown) => void) {
  return new MockLanguageModelV3({
    doGenerate: ({ prompt }) => {
      capture?.(prompt);
      return Promise.resolve({
        content: [{ text, type: "text" as const }],
        finishReason: { raw: undefined, unified: "stop" as const },
        usage,
        warnings: [],
      });
    },
  });
}

test.describe("OCR", () => {
  test("reads a real PNG through the vision path", async () => {
    let prompt: unknown;
    const result = await runOcr({
      buffer: png,
      mimeType: "image/png",
      model: modelReturning("HELLO 123", (value) => {
        prompt = value;
      }),
    });

    expect(result.text).toBe("HELLO 123");
    expect(result.wordCount).toBe(2);
    expect(result.model).toBe("gemini-3.5-flash-lite");
    expect(JSON.stringify(prompt)).toContain("image/png");
  });

  test("returns a clear no-text result instead of an empty string", async () => {
    const result = await runOcr({
      buffer: png,
      mimeType: "image/png",
      model: modelReturning("(no text detected)"),
    });

    expect(result.text).toBe("(no text detected)");
    expect(result.wordCount).toBe(0);
  });

  test("converts a GIF before sending it to Gemini", async () => {
    const result = await runOcr({
      buffer: gif,
      mimeType: "image/gif",
      model: modelReturning("GIF TEXT"),
    });

    expect(result.text).toBe("GIF TEXT");
  });

  test("rejects a non-image attachment with a clear message", async () => {
    await expect(
      runOcr({
        buffer: Buffer.from("%PDF-1.7"),
        mimeType: "application/pdf",
        model: modelReturning("unused"),
      })
    ).rejects.toThrow("not an image");
  });
});
