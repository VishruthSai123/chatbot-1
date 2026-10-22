import { expect, test } from "@playwright/test";

import {
  decodeResearchRun,
  encodeResearchRun,
  isSameTopic,
} from "../../lib/research/ref";

const RUN = {
  findings: ["Revenue reached 14250 dollars."],
  queriesAsked: ["north region revenue 2024"],
  report: "# Report\n\nThe answer.",
  sources: [{ note: "note", title: "A page", url: "https://example.com/a" }],
  topic: "What was the North region's revenue?",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test.describe("the run envelope", () => {
  test("round-trips a run", () => {
    const decoded = decodeResearchRun(encodeResearchRun(RUN));

    expect(decoded?.topic).toBe(RUN.topic);
    expect(decoded?.findings).toHaveLength(1);
    expect(decoded?.sources[0].url).toBe("https://example.com/a");
    expect(decoded?.report).toContain("Report");
  });

  test("rejects content that is not a run", () => {
    expect(decodeResearchRun("just some text")).toBe(null);
    expect(decodeResearchRun("")).toBe(null);
    expect(decodeResearchRun(null)).toBe(null);
  });

  test("rejects a malformed envelope", () => {
    expect(decodeResearchRun("research-ref:{broken")).toBe(null);
    expect(decodeResearchRun("research-ref:{}")).toBe(null);
  });
});

test.describe("recognising the same topic", () => {
  test("the same question in different words is the same topic", () => {
    expect(isSameTopic("Revenue in the North?", "revenue in the north")).toBe(
      true
    );
  });

  test("punctuation and case do not matter", () => {
    expect(isSameTopic("What is X?", "what is x")).toBe(true);
  });

  test("one contained in the other is the same question", () => {
    expect(
      isSameTopic("North region revenue", "North region revenue 2024")
    ).toBe(true);
  });

  test("different questions are different topics", () => {
    expect(isSameTopic("revenue in the north", "headcount in emea")).toBe(
      false
    );
  });

  test("empty topics never match", () => {
    expect(isSameTopic("", "")).toBe(false);
    expect(isSameTopic("revenue", "")).toBe(false);
  });
});
