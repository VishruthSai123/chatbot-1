import { expect, test } from "@playwright/test";

import {
  applyResizeRequirement,
  describeRequirement,
  isEmptyRequirement,
  parseImageRequirement,
} from "../../lib/image/requirements";

test.describe("parseImageRequirement — physical & pixel sizes", () => {
  test("parses physical mm dimensions", () => {
    const { spec } = parseImageRequirement("make it 35x45mm");
    expect(spec.width).toBe(35);
    expect(spec.height).toBe(45);
    expect(spec.unit).toBe("mm");
  });

  test("parses inches with spaces for the unit", () => {
    const { spec } = parseImageRequirement("make it 2 x 2 inch");
    expect(spec.width).toBe(2);
    expect(spec.height).toBe(2);
    expect(spec.unit).toBe("in");
  });

  test("parses pixels when no unit is given", () => {
    const { spec } = parseImageRequirement("resize to 800x600");
    expect(spec.width).toBe(800);
    expect(spec.height).toBe(600);
    expect(spec.unit).toBe("px");
  });

  test("parses a single edge", () => {
    const { spec } = parseImageRequirement("make it 1000px wide");
    expect(spec.width).toBe(1000);
    expect(spec.height).toBeUndefined();
    expect(spec.unit).toBe("px");
  });

  test("physical units beat pixel parsing for the same pair", () => {
    const { spec } = parseImageRequirement("resize to 6x4 cm");
    expect(spec.unit).toBe("cm");
    expect(spec.width).toBe(6);
  });
});

test.describe("parseImageRequirement — extras", () => {
  test("parses a file-size bound in KB", () => {
    const { spec } = parseImageRequirement("under 50 kb please");
    expect(spec.targetSizeKb).toBe(50);
  });

  test("parses a file-size bound in MB", () => {
    const { spec } = parseImageRequirement("keep it below 2 mb");
    expect(spec.targetSizeKb).toBe(2048);
  });

  test("parses DPI", () => {
    const { spec } = parseImageRequirement("35x45mm at 300 dpi");
    expect(spec.dpi).toBe(300);
  });

  test("parses an aspect ratio", () => {
    const { spec } = parseImageRequirement("crop it to 16:9");
    expect(spec.aspectRatio).toBe("16:9");
  });

  test("parses the square shorthand", () => {
    const { spec } = parseImageRequirement("make it square");
    expect(spec.aspectRatio).toBe("1:1");
  });

  test("parses a percentage scale", () => {
    const { spec } = parseImageRequirement("scale it to 50%");
    expect(spec.scalePercent).toBe(50);
  });

  test("parses doubled / halved wording", () => {
    expect(parseImageRequirement("double the size").spec.scalePercent).toBe(
      200
    );
    expect(parseImageRequirement("half the size").spec.scalePercent).toBe(50);
    expect(parseImageRequirement("upscale 3x").spec.scalePercent).toBe(300);
  });

  test("parses max / min bounds", () => {
    expect(parseImageRequirement("max 2000px").spec.maxLongEdge).toBe(2000);
    const min = parseImageRequirement("at least 800px").spec;
    expect(min.minWidth).toBe(800);
    expect(min.minHeight).toBe(800);
  });

  test("parses pad + colour", () => {
    const { spec } = parseImageRequirement("800x800 pad with white");
    expect(spec.fit).toBe("pad");
    expect(spec.padColor).toBe("#ffffff");
  });
});

test.describe("parseImageRequirement — presets", () => {
  test("resolves a country + document type", () => {
    expect(parseImageRequirement("china visa photo").spec.preset).toBe(
      "china_visa"
    );
  });

  test("resolves a specific passport", () => {
    expect(parseImageRequirement("indian passport size").spec.preset).toBe(
      "indian_passport"
    );
  });

  test("falls back to the universal passport preset", () => {
    expect(parseImageRequirement("passport size photo").spec.preset).toBe(
      "passport_photo"
    );
  });

  test("resolves a print ratio without a unit", () => {
    expect(parseImageRequirement("4x6 print").spec.preset).toBe("photo_4x6");
  });

  test("resolves a green card", () => {
    expect(parseImageRequirement("green card photo").spec.preset).toBe(
      "us_green_card"
    );
  });
});

test.describe("parseImageRequirement — non-geometry requests", () => {
  test("returns an empty requirement for a conversion", () => {
    const parsed = parseImageRequirement("convert this to webp");
    expect(isEmptyRequirement(parsed)).toBe(true);
    expect(describeRequirement(parsed)).toBeNull();
  });

  test("handles empty input", () => {
    expect(isEmptyRequirement(parseImageRequirement(""))).toBe(true);
    expect(isEmptyRequirement(parseImageRequirement("   "))).toBe(true);
  });
});

test.describe("describeRequirement", () => {
  test("produces a prompt-ready line", () => {
    const line = describeRequirement(
      parseImageRequirement("35x45mm at 600dpi")
    );
    expect(line).toContain("width=35");
    expect(line).toContain("height=45");
    expect(line).toContain("unit=mm");
    expect(line).toContain("dpi=600");
  });
});

test.describe("applyResizeRequirement", () => {
  test("fills gaps the model left empty", () => {
    const merged = applyResizeRequirement(
      { width: 35 },
      { dpi: 300, height: 45, unit: "mm", width: 35 }
    );
    expect(merged.height).toBe(45);
    expect(merged.unit).toBe("mm");
    expect(merged.dpi).toBe(300);
  });

  test("repairs a physical request that defaulted to px", () => {
    const merged = applyResizeRequirement(
      { dpi: 300, height: 45, unit: "px", width: 35 },
      { dpi: 600, height: 45, unit: "mm", width: 35 }
    );
    expect(merged.unit).toBe("mm");
    expect(merged.dpi).toBe(600);
  });

  test("never overrides an explicit differing size", () => {
    const merged = applyResizeRequirement(
      { unit: "px", width: 800 },
      { height: 45, unit: "mm", width: 35 }
    );
    expect(merged.width).toBe(800);
    expect(merged.unit).toBe("px");
  });

  test("passes explicit values through when there is no requirement", () => {
    const explicit = { unit: "px" as const, width: 1200 };
    expect(applyResizeRequirement(explicit, undefined)).toEqual(explicit);
  });
});
