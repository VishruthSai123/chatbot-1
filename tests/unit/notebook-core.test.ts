import { expect, test } from "@playwright/test";

import { buildBm25Index } from "../../lib/notebook/bm25";
import {
  chunkText,
  estimateChunkCount,
  tokenize,
} from "../../lib/notebook/chunk";
import { decodeNotebookRef, encodeNotebookRef } from "../../lib/notebook/ref";
import { estimateTokens, planRetrieval } from "../../lib/notebook/retrieval";

test.describe("tokenizing", () => {
  test("lowercases and splits on punctuation", () => {
    expect(tokenize("Revenue, in 2024; was 1,200.")).toContain("revenue");
    expect(tokenize("Revenue, in 2024")).toContain("2024");
  });

  test("drops stop words and single characters", () => {
    const tokens = tokenize("the a of revenue 5 x");

    expect(tokens).toContain("revenue");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("x");
  });

  test("indexes a hyphenated word the same as two words", () => {
    // "well-known" and "well known" must find the same passage.
    expect(tokenize("well-known")).toEqual(tokenize("well known"));
  });
});

test.describe("chunking", () => {
  test("keeps a short text as one chunk", () => {
    const chunks = chunkText({ text: "A short note." });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("A short note.");
  });

  test("splits a long text into several chunks", () => {
    const paragraph = "word ".repeat(400);
    const chunks = chunkText({ maxChars: 500, text: paragraph });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(700);
    }
  });

  test("keeps the label on every chunk", () => {
    const chunks = chunkText({
      label: "Page 4",
      maxChars: 200,
      text: "word ".repeat(200),
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.label === "Page 4")).toBe(true);
  });

  test("numbers the chunks in order across a source", () => {
    const chunks = chunkText({
      label: "Page 1",
      maxChars: 200,
      startIndex: 5,
      text: "word ".repeat(200),
    });

    expect(chunks[0].index).toBe(5);
    expect(chunks[1].index).toBe(6);
  });

  test("an empty text produces no chunks", () => {
    expect(chunkText({ text: "   " })).toHaveLength(0);
  });

  test("the estimate agrees with the real count", () => {
    const text = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index}. ${"word ".repeat(60)}`
    ).join("\n\n");

    expect(estimateChunkCount(text)).toBe(chunkText({ text }).length);
  });
});

test.describe("bm25", () => {
  const documents = [
    {
      id: "a",
      text: "The revenue in 2024 was 14250 dollars across all regions.",
    },
    {
      id: "b",
      text: "The headcount grew by twelve people in the same period.",
    },
    {
      id: "c",
      text: "Revenue guidance for 2025 was raised after the quarter.",
    },
  ];

  test("finds the passage that mentions the query", () => {
    const index = buildBm25Index(documents);
    const hits = index.search("revenue 2024");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("a");
  });

  test("ranks the exact match above the incidental one", () => {
    const index = buildBm25Index(documents);
    const hits = index.search("headcount grew");

    expect(hits[0].id).toBe("b");
  });

  test("an unknown term returns nothing", () => {
    const index = buildBm25Index(documents);

    expect(index.search("xylophone")).toHaveLength(0);
  });

  test("an empty query returns nothing", () => {
    const index = buildBm25Index(documents);

    expect(index.search("")).toHaveLength(0);
  });

  test("respects the limit", () => {
    const index = buildBm25Index(documents);

    expect(index.search("revenue the", 1)).toHaveLength(1);
  });

  test("an empty index returns nothing", () => {
    const index = buildBm25Index([]);

    expect(index.search("revenue")).toHaveLength(0);
    expect(index.size).toBe(0);
  });
});

test.describe("choosing between context and search", () => {
  const chunks = Array.from({ length: 20 }, (_, index) => ({
    id: `chunk-${index}`,
    index,
    label: `Page ${index + 1}`,
    text: `Passage number ${index} about revenue and the quarter.`,
  }));

  test("a small notebook goes in whole", () => {
    const plan = planRetrieval({ chunks, query: "revenue" });

    expect(plan.kind).toBe("full");
    expect(plan.passages).toHaveLength(chunks.length);
  });

  test("a large notebook is searched", () => {
    const plan = planRetrieval({
      chunks,
      query: "Passage number 7",
      tokenBudget: 10,
    });

    expect(plan.kind).toBe("searched");
    expect(plan.passages.length).toBeLessThan(chunks.length);
    expect(plan.passages.length).toBeGreaterThan(0);
  });

  test("searched passages stay in reading order", () => {
    const plan = planRetrieval({
      chunks,
      query: "Passage",
      tokenBudget: 10,
    });

    const indexes = plan.passages.map((passage) => passage.index);

    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  test("an empty notebook retrieves nothing", () => {
    const plan = planRetrieval({ chunks: [], query: "revenue" });

    expect(plan.kind).toBe("full");
    expect(plan.passages).toHaveLength(0);
  });

  test("the token estimate is roughly four characters per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

test.describe("the notebook envelope", () => {
  test("round-trips a notebook", () => {
    const ref = {
      sources: [
        { addedAt: "2026-01-01", kind: "file" as const, title: "report.pdf" },
        {
          addedAt: "2026-01-01",
          kind: "url" as const,
          title: "a.com",
          url: "https://a.com",
        },
      ],
      title: "Research",
    };

    const decoded = decodeNotebookRef(encodeNotebookRef(ref));

    expect(decoded?.title).toBe("Research");
    expect(decoded?.sources).toHaveLength(2);
    expect(decoded?.sources[1].url).toBe("https://a.com");
  });

  test("rejects content that is not a notebook", () => {
    expect(decodeNotebookRef("just some text")).toBe(null);
    expect(decodeNotebookRef("")).toBe(null);
    expect(decodeNotebookRef(null)).toBe(null);
  });

  test("rejects a malformed envelope", () => {
    expect(decodeNotebookRef("notebook-ref:{broken")).toBe(null);
    expect(decodeNotebookRef("notebook-ref:{}")).toBe(null);
  });
});
