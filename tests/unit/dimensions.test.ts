import { expect, test } from "@playwright/test";

import {
  parseAspectRatio,
  resolveTargetGeometry,
} from "../../lib/image/dimensions";
import { PHOTO_PRESETS } from "../../lib/image/presets";

const SRC_4x3 = { height: 3000, width: 4000 };

test.describe("parseAspectRatio", () => {
  test("parses colon, slash and x separators", () => {
    expect(parseAspectRatio("16:9")).toBeCloseTo(16 / 9, 6);
    expect(parseAspectRatio("4/5")).toBeCloseTo(4 / 5, 6);
    expect(parseAspectRatio("3x2")).toBeCloseTo(3 / 2, 6);
  });

  test("parses square, decimals and numbers", () => {
    expect(parseAspectRatio("square")).toBe(1);
    expect(parseAspectRatio("1:1")).toBe(1);
    expect(parseAspectRatio("1.78")).toBeCloseTo(1.78, 6);
    expect(parseAspectRatio(2)).toBe(2);
  });

  test("rejects junk", () => {
    expect(parseAspectRatio("")).toBeNull();
    expect(parseAspectRatio("abc")).toBeNull();
    expect(parseAspectRatio("0:1")).toBeNull();
    expect(parseAspectRatio(null)).toBeNull();
    expect(parseAspectRatio(Number.NaN)).toBeNull();
  });
});

test.describe("resolveTargetGeometry — exact pixels", () => {
  test("honours explicit px width and height", () => {
    const g = resolveTargetGeometry(
      { height: 600, unit: "px", width: 800 },
      SRC_4x3
    );
    expect(g.width).toBe(800);
    expect(g.height).toBe(600);
    expect(g.dpi).toBe(300);
    expect(g.fit).toBe("cover");
  });

  test("single width preserves source aspect ratio", () => {
    const g = resolveTargetGeometry({ unit: "px", width: 1000 }, SRC_4x3);
    expect(g.width).toBe(1000);
    expect(g.height).toBe(750);
  });

  test("single height preserves source aspect ratio", () => {
    const g = resolveTargetGeometry({ height: 500, unit: "px" }, SRC_4x3);
    expect(g.height).toBe(500);
    expect(g.width).toBe(667);
  });
});

test.describe("resolveTargetGeometry — physical units", () => {
  test("35x45 mm at 300 DPI matches the passport pixel math", () => {
    const g = resolveTargetGeometry(
      { dpi: 300, height: 45, unit: "mm", width: 35 },
      SRC_4x3
    );
    expect(g.width).toBe(413);
    expect(g.height).toBe(531);
  });

  test("2x2 inches at 300 DPI = 600x600", () => {
    const g = resolveTargetGeometry(
      { dpi: 300, height: 2, unit: "in", width: 2 },
      SRC_4x3
    );
    expect(g.width).toBe(600);
    expect(g.height).toBe(600);
  });

  test("physical size scales with DPI", () => {
    const g = resolveTargetGeometry(
      { dpi: 600, height: 45, unit: "mm", width: 35 },
      SRC_4x3
    );
    expect(g.width).toBe(827);
    expect(g.height).toBe(1063);
  });
});

test.describe("resolveTargetGeometry — relative scale", () => {
  test("50% halves both edges", () => {
    const g = resolveTargetGeometry(
      { scalePercent: 50 },
      { height: 500, width: 1000 }
    );
    expect(g.width).toBe(500);
    expect(g.height).toBe(250);
  });

  test("200% doubles both edges", () => {
    const g = resolveTargetGeometry(
      { scalePercent: 200 },
      { height: 500, width: 1000 }
    );
    expect(g.width).toBe(2000);
    expect(g.height).toBe(1000);
  });

  test("never collapses below 1px", () => {
    const g = resolveTargetGeometry(
      { scalePercent: 1 },
      { height: 100, width: 100 }
    );
    expect(g.width).toBe(1);
    expect(g.height).toBe(1);
  });
});

test.describe("resolveTargetGeometry — aspect ratio", () => {
  test("aspect ratio alone keeps the longest edge", () => {
    const g = resolveTargetGeometry({ aspectRatio: "16:9" }, SRC_4x3);
    expect(g.width).toBe(4000);
    expect(g.height).toBe(2250);
  });

  test("aspect ratio with width derives height", () => {
    const g = resolveTargetGeometry(
      { aspectRatio: "16:9", unit: "px", width: 1600 },
      SRC_4x3
    );
    expect(g.width).toBe(1600);
    expect(g.height).toBe(900);
  });

  test("aspect ratio with height derives width", () => {
    const g = resolveTargetGeometry(
      { aspectRatio: "1:1", height: 800, unit: "px" },
      SRC_4x3
    );
    expect(g.width).toBe(800);
    expect(g.height).toBe(800);
  });
});

test.describe("resolveTargetGeometry — bounds", () => {
  test("maxLongEdge clamps proportionally", () => {
    const g = resolveTargetGeometry(
      { height: 3000, maxLongEdge: 2000, unit: "px", width: 4000 },
      SRC_4x3
    );
    expect(g.width).toBe(2000);
    expect(g.height).toBe(1500);
  });

  test("maxWidth clamps proportionally", () => {
    const g = resolveTargetGeometry(
      { height: 3000, maxWidth: 1000, unit: "px", width: 4000 },
      SRC_4x3
    );
    expect(g.width).toBe(1000);
    expect(g.height).toBe(750);
  });

  test("minWidth expands proportionally", () => {
    const g = resolveTargetGeometry(
      { height: 100, minWidth: 200, unit: "px", width: 100 },
      SRC_4x3
    );
    expect(g.width).toBe(200);
    expect(g.height).toBe(200);
  });

  test("allowUpscale false never enlarges", () => {
    const g = resolveTargetGeometry(
      { allowUpscale: false, height: 2000, unit: "px", width: 2000 },
      { height: 1000, width: 1000 }
    );
    expect(g.width).toBe(1000);
    expect(g.height).toBe(1000);
  });
});

test.describe("resolveTargetGeometry — presets & behaviour", () => {
  test("preset expands to physical geometry", () => {
    const g = resolveTargetGeometry({ preset: "indian_passport" }, SRC_4x3);
    expect(g.width).toBe(413);
    expect(g.height).toBe(531);
    expect(g.dpi).toBe(300);
  });

  test("every preset resolves to its documented pixels", () => {
    for (const preset of PHOTO_PRESETS) {
      const g = resolveTargetGeometry({ preset: preset.key }, SRC_4x3);
      expect(g.width, `${preset.key} width`).toBe(preset.resultPxWidth);
      expect(g.height, `${preset.key} height`).toBe(preset.resultPxHeight);
    }
  });

  test("fit pad defaults to a white background", () => {
    const g = resolveTargetGeometry(
      { fit: "pad", height: 500, unit: "px", width: 500 },
      SRC_4x3
    );
    expect(g.padColor).toBe("#ffffff");
  });

  test("fit cover clears padColor", () => {
    const g = resolveTargetGeometry(
      {
        fit: "cover",
        height: 500,
        padColor: "#000000",
        unit: "px",
        width: 500,
      },
      SRC_4x3
    );
    expect(g.padColor).toBeUndefined();
  });

  test("targetSizeKb passes through untouched", () => {
    const g = resolveTargetGeometry(
      { height: 500, targetSizeKb: 50, unit: "px", width: 500 },
      SRC_4x3
    );
    expect(g.targetSizeKb).toBe(50);
  });

  test("empty spec is identity", () => {
    const g = resolveTargetGeometry({}, SRC_4x3);
    expect(g.width).toBe(4000);
    expect(g.height).toBe(3000);
    expect(g.scaleFactor).toBe(1);
  });
});
