import { expect, test } from "@playwright/test";

import {
  isGeminiImageType,
  resolveImageMediaType,
  sniffImageMediaType,
} from "../../lib/ai/vision-limits";

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gif = Buffer.from("GIF89a", "ascii");
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

test.describe("vision image rules", () => {
  test("detects image types from bytes, not the filename", () => {
    expect(sniffImageMediaType(png)).toBe("image/png");
    expect(sniffImageMediaType(jpeg)).toBe("image/jpeg");
    expect(sniffImageMediaType(gif)).toBe("image/gif");
    expect(sniffImageMediaType(webp)).toBe("image/webp");
    expect(sniffImageMediaType(svg)).toBe("image/svg+xml");
    expect(resolveImageMediaType(jpeg, "image/png")).toBe("image/jpeg");
  });

  test("only marks Gemini-compatible image types as direct", () => {
    expect(isGeminiImageType("image/png")).toBe(true);
    expect(isGeminiImageType("image/jpeg")).toBe(true);
    expect(isGeminiImageType("image/webp")).toBe(true);
    expect(isGeminiImageType("image/gif")).toBe(false);
    expect(isGeminiImageType("image/svg+xml")).toBe(false);
    expect(isGeminiImageType("application/pdf")).toBe(false);
  });
});
