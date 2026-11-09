import { expect, test } from "@playwright/test";

import { mergeSearchSources } from "../../lib/search/merge";
import { decodeSearchRef, encodeSearchRef } from "../../lib/search/ref";

test.describe("search artifacts", () => {
  test("round-trips a research result", () => {
    const encoded = encodeSearchRef({
      answer: "Short answer",
      depth: "standard",
      kind: "research",
      query: "How does Gemini grounding work?",
      report: "# Report\n\nLonger findings.",
      sources: [
        { title: "Google", url: "https://ai.google.dev" },
        { url: "https://example.com/page" },
      ],
    });

    expect(decodeSearchRef(encoded)).toEqual({
      answer: "Short answer",
      depth: "standard",
      kind: "research",
      query: "How does Gemini grounding work?",
      report: "# Report\n\nLonger findings.",
      sources: [
        { title: "Google", url: "https://ai.google.dev" },
        { title: undefined, url: "https://example.com/page" },
      ],
      url: undefined,
    });
  });

  test("rejects content that is not a search ref", () => {
    expect(decodeSearchRef("plain text")).toBeNull();
    expect(decodeSearchRef("search-ref:not-json")).toBeNull();
  });
});

test.describe("search source merging", () => {
  test("deduplicates by URL and preserves order", () => {
    expect(
      mergeSearchSources(
        [
          { title: "First", url: "https://a.example" },
          { title: "Second", url: "https://b.example" },
        ],
        [
          { title: "First again", url: "https://a.example" },
          { title: "Third", url: "https://c.example" },
        ]
      )
    ).toEqual([
      { title: "First", url: "https://a.example" },
      { title: "Second", url: "https://b.example" },
      { title: "Third", url: "https://c.example" },
    ]);
  });

  test("drops empty URLs and trims titles", () => {
    expect(
      mergeSearchSources([
        { title: "  ", url: "  " },
        { title: "  Named  ", url: " https://example.com " },
      ])
    ).toEqual([{ title: "Named", url: "https://example.com" }]);
  });
});
