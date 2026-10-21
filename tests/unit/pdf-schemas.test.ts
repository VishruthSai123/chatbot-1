import { expect, test } from "@playwright/test";
import {
  arrangeSchema,
  extractTextSchema,
  imagesToPdfSchema,
  mergeSchema,
  rotateSchema,
  splitSchema,
} from "../../lib/tools/pdf/types";

test.describe("PDF Schema Validation", () => {
  test("imagesToPdfSchema defaults layout to fit and allows optional margin/title", () => {
    const parsed = imagesToPdfSchema.parse({});
    expect(parsed.layout).toBe("fit");
    expect(parsed.documentIds).toBeUndefined();

    const withValues = imagesToPdfSchema.parse({
      documentIds: ["doc-1", "doc-2"],
      layout: "a4",
      margin: 20,
      title: "My Scans",
    });
    expect(withValues.layout).toBe("a4");
    expect(withValues.margin).toBe(20);
    expect(withValues.title).toBe("My Scans");
    expect(withValues.documentIds).toEqual(["doc-1", "doc-2"]);
  });

  test("imagesToPdfSchema rejects invalid layout", () => {
    expect(() =>
      imagesToPdfSchema.parse({
        layout: "tabloid" as any,
      })
    ).toThrow();
  });

  test("mergeSchema accepts optional filenames", () => {
    const parsed = mergeSchema.parse({ filenames: ["doc1.pdf", "doc2.pdf"] });
    expect(parsed.filenames).toEqual(["doc1.pdf", "doc2.pdf"]);
  });

  test("splitSchema parses page ranges or allows undefined", () => {
    const parsed = splitSchema.parse({ pageRanges: "1-3; 4-6" });
    expect(parsed.pageRanges).toBe("1-3; 4-6");

    const empty = splitSchema.parse({});
    expect(empty.pageRanges).toBeUndefined();
  });

  test("arrangeSchema validates page orders and rotations", () => {
    const parsed = arrangeSchema.parse({
      pageOrder: [3, 1, 2],
      rotations: { "2": 90 },
    });
    expect(parsed.pageOrder).toEqual([3, 1, 2]);
    expect(parsed.rotations?.["2"]).toBe(90);
  });

  test("rotateSchema defaults pages to 'all' and validates degrees", () => {
    const parsed = rotateSchema.parse({ degrees: 90 });
    expect(parsed.degrees).toBe(90);
    expect(parsed.pages).toBe("all");

    const explicit = rotateSchema.parse({ degrees: -90, pages: [1, 2] });
    expect(explicit.pages).toEqual([1, 2]);
  });

  test("extractTextSchema accepts optional page ranges", () => {
    const parsed = extractTextSchema.parse({ pageRanges: "1-5" });
    expect(parsed.pageRanges).toBe("1-5");
  });
});
