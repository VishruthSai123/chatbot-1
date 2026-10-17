import { expect, test } from "@playwright/test";

import {
  findPresetsByQuery,
  getPresetByKey,
  groupPresetsByCategory,
  PHOTO_PRESETS,
  PRESET_CATEGORY_LABELS,
  physicalToPixels,
} from "../../lib/image/presets";

test.describe("PHOTO_PRESETS catalogue", () => {
  test("every key is unique", () => {
    const keys = PHOTO_PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every preset has a category with a label", () => {
    for (const preset of PHOTO_PRESETS) {
      expect(
        PRESET_CATEGORY_LABELS[preset.category],
        `${preset.key} category`
      ).toBeTruthy();
    }
  });

  test("documented pixels match the physical → pixel math", () => {
    for (const preset of PHOTO_PRESETS) {
      expect(
        physicalToPixels(preset.width, preset.unit, preset.dpi),
        `${preset.key} width`
      ).toBe(preset.resultPxWidth);
      expect(
        physicalToPixels(preset.height, preset.unit, preset.dpi),
        `${preset.key} height`
      ).toBe(preset.resultPxHeight);
    }
  });

  test("getPresetByKey resolves new entries", () => {
    expect(getPresetByKey("china_visa")?.displayName).toBe("China Visa");
    expect(getPresetByKey("passport_photo")?.resultPxWidth).toBe(413);
    expect(getPresetByKey("does_not_exist")).toBeUndefined();
  });
});

test.describe("groupPresetsByCategory", () => {
  test("covers every preset exactly once", () => {
    const groups = groupPresetsByCategory();
    const total = groups.reduce((sum, group) => sum + group.presets.length, 0);
    expect(total).toBe(PHOTO_PRESETS.length);
  });

  test("never emits an empty group", () => {
    for (const group of groupPresetsByCategory()) {
      expect(group.presets.length).toBeGreaterThan(0);
      expect(group.label).toBe(PRESET_CATEGORY_LABELS[group.category]);
    }
  });
});

test.describe("findPresetsByQuery", () => {
  test("resolves a country + document", () => {
    expect(findPresetsByQuery("china visa")[0]?.key).toBe("china_visa");
  });

  test("resolves an alias", () => {
    expect(findPresetsByQuery("green card")[0]?.key).toBe("us_green_card");
  });

  test("resolves loose physical wording", () => {
    expect(
      findPresetsByQuery("2x2 inch").some((p) => p.key === "us_visa")
    ).toBe(true);
  });

  test("returns the catalogue head for an empty query", () => {
    expect(findPresetsByQuery("")).toHaveLength(5);
    expect(findPresetsByQuery("   ", 3)).toHaveLength(3);
  });

  test("honours the limit and drops non-matches", () => {
    expect(findPresetsByQuery("visa", 2).length).toBeLessThanOrEqual(2);
    expect(findPresetsByQuery("zzzzzz-not-a-thing")).toHaveLength(0);
  });
});
