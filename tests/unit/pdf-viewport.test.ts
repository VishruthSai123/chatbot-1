import { expect, test } from "@playwright/test";

import {
  canvasSizeFor,
  fitScale,
  isUsableViewport,
} from "../../lib/pdf/viewport";

test.describe("viewport usability", () => {
  test("a normal viewport is usable", () => {
    expect(isUsableViewport({ height: 842, width: 595 })).toBe(true);
  });

  test("the NaN viewport is not usable", () => {
    // This is the failure that blanked every PDF page: pdf.js v6 dropped the
    // `scale = 1` default from getViewport, so a viewport built without a
    // scale has NaN dimensions.
    expect(isUsableViewport({ height: Number.NaN, width: Number.NaN })).toBe(
      false
    );
    expect(isUsableViewport({ height: 842, width: Number.NaN })).toBe(false);
  });

  test("a zero or negative viewport is not usable", () => {
    expect(isUsableViewport({ height: 0, width: 100 })).toBe(false);
    expect(isUsableViewport({ height: 100, width: 0 })).toBe(false);
    expect(isUsableViewport({ height: -5, width: 100 })).toBe(false);
  });

  test("an infinite viewport is not usable", () => {
    expect(
      isUsableViewport({ height: Number.POSITIVE_INFINITY, width: 100 })
    ).toBe(false);
  });
});

test.describe("canvas size", () => {
  test("rounds a usable viewport down to whole pixels", () => {
    expect(canvasSizeFor({ height: 254.7, width: 180.4 })).toEqual({
      height: 254,
      width: 180,
    });
  });

  test("refuses a NaN viewport instead of returning zero", () => {
    // Math.max(1, NaN) is NaN, and a canvas assigned NaN becomes 0x0 — which
    // is precisely the blank page.
    expect(canvasSizeFor({ height: Number.NaN, width: Number.NaN })).toBe(null);
  });

  test("refuses a sub-pixel viewport", () => {
    expect(canvasSizeFor({ height: 0.4, width: 0.4 })).toBe(null);
  });
});

test.describe("fit scale", () => {
  test("scales a page into the target width", () => {
    expect(fitScale(595, 180, 1)).toBeCloseTo(180 / 595);
  });

  test("multiplies by the device pixel ratio", () => {
    expect(fitScale(595, 180, 2)).toBeCloseTo((180 / 595) * 2);
  });

  test("falls back to 1 rather than producing NaN", () => {
    expect(fitScale(Number.NaN, 180, 2)).toBe(1);
    expect(fitScale(0, 180, 2)).toBe(1);
    expect(fitScale(595, 0, 2)).toBe(1);
  });

  test("an invalid device pixel ratio does not poison the scale", () => {
    expect(fitScale(595, 180, Number.NaN)).toBeCloseTo(180 / 595);
    expect(fitScale(595, 180, 0)).toBeCloseTo(180 / 595);
  });
});
