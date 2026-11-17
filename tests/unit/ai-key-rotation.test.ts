import { expect, test } from "@playwright/test";

import { parseGoogleApiKeys } from "../../lib/ai/api-keys";
import { shouldUseFallback } from "../../lib/ai/fallback";

test.describe("Google credential rotation", () => {
  test("uses the primary key first", () => {
    expect(
      parseGoogleApiKeys({
        GEMINI_API_KEY: "primary",
      })
    ).toEqual(["primary"]);
  });

  test("supports an overlapping next key without duplicates", () => {
    expect(
      parseGoogleApiKeys({
        GEMINI_API_KEY: "old",
        GEMINI_API_KEY_NEXT: "new",
        GOOGLE_GENERATIVE_AI_API_KEY: "old",
      })
    ).toEqual(["old", "new"]);
  });

  test("supports a comma or whitespace separated pool", () => {
    expect(
      parseGoogleApiKeys({
        GEMINI_API_KEYS: "one, two three\nfour",
      })
    ).toEqual(["one", "two", "three", "four"]);
  });

  test("ignores blank and whitespace-only credentials", () => {
    expect(
      parseGoogleApiKeys({
        GEMINI_API_KEY: "   ",
        GEMINI_API_KEYS: " , ",
      })
    ).toEqual([]);
  });
});

test.describe("provider fallback classification", () => {
  const statusError = (statusCode: number) =>
    Object.assign(new Error("provider error"), { statusCode });

  test("retries auth, quota, rate-limit and server failures", () => {
    for (const status of [401, 402, 403, 404, 408, 429, 500, 502, 503, 504]) {
      expect(shouldUseFallback(statusError(status))).toBe(true);
    }
  });

  test("does not retry bad requests or aborted streams", () => {
    expect(shouldUseFallback(statusError(400))).toBe(false);
    expect(
      shouldUseFallback(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      )
    ).toBe(false);
  });
});
