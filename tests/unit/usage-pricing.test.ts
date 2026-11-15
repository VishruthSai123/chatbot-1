import { expect, test } from "@playwright/test";

import { periodBounds } from "../../lib/usage/periods";
import { chatCost, liveCost, priceFor } from "../../lib/usage/pricing";

test.describe("usage periods", () => {
  test("uses UTC day boundaries", () => {
    const bounds = periodBounds("day", new Date("2026-11-12T23:59:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  test("uses calendar-month boundaries", () => {
    const bounds = periodBounds("month", new Date("2026-11-12T12:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  test("uses Monday UTC boundaries for weekly quotas", () => {
    // 2026-11-15 is a Sunday; the current week started on Monday the 9th.
    const bounds = periodBounds("week", new Date("2026-11-15T23:59:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

test.describe("model pricing", () => {
  test("prices the free-tier model on the flex lane", () => {
    const price = priceFor("gemini-3.1-flash-lite", "flex");
    expect(price.inputPer1M).toBe(0.125);
    expect(price.outputPer1M).toBe(0.75);
  });

  test("prices a 22k-token frontier-style message", () => {
    const cost = chatCost({
      cachedTokens: 0,
      inputTokens: 22_000,
      lane: "standard",
      model: "gemini-3.5-flash-lite",
      outputTokens: 600,
    });
    expect(cost).toBeCloseTo(0.0081, 4);
  });

  test("prices a 4k-token cached free-tier message", () => {
    const cost = chatCost({
      cachedTokens: 2000,
      inputTokens: 4000,
      lane: "flex",
      model: "gemini-3.1-flash-lite",
      outputTokens: 400,
    });
    expect(cost).toBeCloseTo(0.000_575, 4);
  });

  test("prices Live audio per minute", () => {
    const cost = liveCost({
      model: "gemini-3.8-live",
      seconds: 600,
    });
    expect(cost).toBeCloseTo(0.115, 4);
  });
});
