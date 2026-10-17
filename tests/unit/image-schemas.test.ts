import { expect, test } from "@playwright/test";

import {
  compressSchema,
  cropSchema,
  resizeSchema,
  rotateSchema,
  upscaleSchema,
} from "../../lib/tools/image/types";

test.describe("resizeSchema", () => {
  test("requires at least one sizing input", () => {
    expect(resizeSchema.safeParse({}).success).toBe(false);
  });

  test("accepts a single px width and defaults unit/dpi", () => {
    const parsed = resizeSchema.parse({ width: 800 });
    expect(parsed.width).toBe(800);
    expect(parsed.unit).toBe("px");
    expect(parsed.dpi).toBe(300);
    expect(parsed.fit).toBe("cover");
  });

  test("accepts physical dimensions with DPI", () => {
    const parsed = resizeSchema.parse({
      dpi: 300,
      height: 45,
      unit: "mm",
      width: 35,
    });
    expect(parsed.unit).toBe("mm");
    expect(parsed.height).toBe(45);
  });

  test("accepts aspect ratio, scale percent and bounds", () => {
    expect(resizeSchema.parse({ aspectRatio: "16:9" }).aspectRatio).toBe(
      "16:9"
    );
    expect(resizeSchema.parse({ scalePercent: 50 }).scalePercent).toBe(50);
    expect(resizeSchema.parse({ maxLongEdge: 2000 }).maxLongEdge).toBe(2000);
    expect(resizeSchema.parse({ maxWidth: 100 }).maxWidth).toBe(100);
  });

  test("accepts a preset key", () => {
    expect(resizeSchema.parse({ preset: "us_visa" }).preset).toBe("us_visa");
  });

  test("accepts a combined size bound", () => {
    const parsed = resizeSchema.parse({
      height: 100,
      targetSizeKb: 50,
      width: 100,
    });
    expect(parsed.targetSizeKb).toBe(50);
  });

  test("accepts pad fit with a colour", () => {
    const parsed = resizeSchema.parse({
      fit: "pad",
      height: 10,
      padColor: "#ffffff",
      width: 10,
    });
    expect(parsed.fit).toBe("pad");
    expect(parsed.padColor).toBe("#ffffff");
  });
});

test.describe("cropSchema", () => {
  test("requires an aspect ratio or a full box", () => {
    expect(cropSchema.safeParse({}).success).toBe(false);
    expect(cropSchema.safeParse({ left: 0, width: 10 }).success).toBe(false);
  });

  test("accepts an aspect ratio and defaults to centre", () => {
    const parsed = cropSchema.parse({ aspectRatio: "1:1" });
    expect(parsed.aspectRatio).toBe("1:1");
    expect(parsed.mode).toBe("center");
  });

  test("accepts a full pixel box", () => {
    const parsed = cropSchema.parse({
      height: 10,
      left: 5,
      top: 5,
      width: 10,
    });
    expect(parsed.left).toBe(5);
  });
});

test.describe("upscaleSchema", () => {
  test("defaults to 2x", () => {
    expect(upscaleSchema.parse({}).scale).toBe(2);
  });

  test("accepts an arbitrary scale 1-8", () => {
    expect(upscaleSchema.parse({ scale: 3 }).scale).toBe(3);
    expect(upscaleSchema.safeParse({ scale: 20 }).success).toBe(false);
    expect(upscaleSchema.safeParse({ scale: 0 }).success).toBe(false);
  });

  test("accepts explicit targets and a max long edge", () => {
    expect(upscaleSchema.parse({ targetWidth: 2000 }).targetWidth).toBe(2000);
    expect(upscaleSchema.parse({ maxLongEdge: 4000 }).maxLongEdge).toBe(4000);
  });
});

test.describe("rotateSchema", () => {
  test("accepts arbitrary angles within range", () => {
    expect(rotateSchema.parse({ degrees: 45 }).degrees).toBe(45);
    expect(rotateSchema.safeParse({ degrees: 400 }).success).toBe(false);
  });
});

test.describe("compressSchema", () => {
  test("defaults quality and accepts a size target", () => {
    expect(compressSchema.parse({}).quality).toBe(80);
    expect(compressSchema.parse({ targetSizeKb: 50 }).targetSizeKb).toBe(50);
  });
});
