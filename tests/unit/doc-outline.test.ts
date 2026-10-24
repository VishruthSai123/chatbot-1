import { expect, test } from "@playwright/test";

import {
  decodeDocRef,
  encodeDocRef,
  flattenOutline,
  isDocRef,
} from "../../lib/doc/ref";

test.describe("the document descriptor", () => {
  test("round-trips through its envelope", () => {
    const encoded = encodeDocRef({
      filename: "report.md",
      format: "md",
      stats: {
        characters: 100,
        minutesToRead: 1,
        minutesToSpeak: 1,
        paragraphs: 4,
        sentences: 8,
        words: 20,
      },
      storageKey: "user/general/report.md",
      text: "# Report",
      title: "report.md",
    });

    expect(isDocRef(encoded)).toBe(true);

    const decoded = decodeDocRef(encoded);

    expect(decoded?.text).toBe("# Report");
    expect(decoded?.filename).toBe("report.md");
    expect(decoded?.stats?.words).toBe(20);
  });

  test("refuses anything that is not a document descriptor", () => {
    expect(decodeDocRef("plain text")).toBeNull();
    expect(decodeDocRef("doc-ref:not json")).toBeNull();
    // A descriptor with no storage key points at nothing.
    expect(decodeDocRef('doc-ref:{"text":"hi"}')).toBeNull();
    expect(decodeDocRef(null)).toBeNull();
  });
});

test.describe("flattening the heading outline", () => {
  test("keeps the nested headings", () => {
    const flat = flattenOutline([
      {
        children: [
          {
            children: [{ children: [], level: 3, text: "Notes" }],
            level: 2,
            text: "Costs",
          },
        ],
        level: 1,
        text: "Revenue",
      },
    ]);

    expect(flat).toHaveLength(3);
    expect(flat.map((heading) => heading.text)).toEqual([
      "Revenue",
      "Costs",
      "Notes",
    ]);
  });

  test("records how deep each heading sits", () => {
    const flat = flattenOutline([
      {
        children: [{ children: [], level: 2, text: "Costs" }],
        level: 1,
        text: "Revenue",
      },
    ]);

    expect(flat[0].depth).toBe(0);
    expect(flat[1].depth).toBe(1);
  });

  test("keeps the heading's own level", () => {
    const flat = flattenOutline([{ children: [], level: 2, text: "Costs" }]);

    expect(flat[0].level).toBe(2);
    expect(flat[0].depth).toBe(0);
  });

  test("copes with an absent or empty outline", () => {
    expect(flattenOutline(undefined)).toEqual([]);
    expect(flattenOutline([])).toEqual([]);
  });

  test("copes with a node that has no children", () => {
    const flat = flattenOutline([{ level: 1, text: "Revenue" } as never]);

    expect(flat).toHaveLength(1);
    expect(flat[0].text).toBe("Revenue");
  });
});
