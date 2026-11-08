import { expect, test } from "@playwright/test";

import {
  hasUsableTextLayer,
  ocrMaxOutputTokens,
  splitOcrPages,
} from "../../lib/pdf/ocr-core";

test.describe("PDF OCR rules", () => {
  test("treats a scan with stray characters as having no text layer", () => {
    expect(hasUsableTextLayer("", 1)).toBe(false);
    expect(hasUsableTextLayer("1", 1)).toBe(false);
    expect(hasUsableTextLayer("1\n2\n3\n4", 4)).toBe(false);
    expect(
      hasUsableTextLayer(
        "Quarterly revenue grew to $128,000 while headcount rose by 12.",
        1
      )
    ).toBe(true);
  });

  test("splits OCR text on decorated page markers", () => {
    const pages = splitOcrPages(
      [
        "Here is the transcription.",
        "--- Page 1 ---",
        "Handwritten title",
        "",
        "## Page 2",
        "Second page text",
        "--- Page 3 ---",
        "(no text on this page)",
      ].join("\n"),
      3
    );

    expect(pages).toEqual([
      { page: 1, text: "Handwritten title" },
      { page: 2, text: "Second page text" },
    ]);
  });

  test("keeps an unmarked transcription as one block", () => {
    expect(splitOcrPages("No markers here.\nJust text.", 2)).toEqual([
      { page: null, text: "No markers here.\nJust text." },
    ]);
  });

  test("does not return a blank-page sentinel as content", () => {
    expect(splitOcrPages("(no text on this page)", 1)).toEqual([]);
  });

  test("treats a marker-only blank page as empty", () => {
    expect(splitOcrPages("--- Page 1 ---\n(no text on this page)", 1)).toEqual(
      []
    );
  });

  test("keeps content pages and drops blank pages", () => {
    expect(
      splitOcrPages(
        "--- Page 1 ---\n(no text on this page)\n--- Page 2 ---\nReal notes",
        2
      )
    ).toEqual([{ page: 2, text: "Real notes" }]);
  });

  test("scales the output budget with the page count", () => {
    expect(ocrMaxOutputTokens(1)).toBe(4096);
    expect(ocrMaxOutputTokens(10)).toBe(8000);
    expect(ocrMaxOutputTokens(100)).toBe(32_768);
  });
});
