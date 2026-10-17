import { expect, test } from "@playwright/test";

import {
  applyCropDrag,
  aspectRatioInPercent,
  boxForAspect,
  type CropBox,
  clampCropBox,
  fullCropBox,
  MIN_CROP_PCT,
} from "../../lib/image/crop-box";

/** Height% for a width% given the percentage-space ratio. */
const heightFor = (width: number, k: number) => width * k;

test.describe("aspectRatioInPercent", () => {
  test("converts a pixel ratio into percentage space for non-square images", () => {
    // 4000x3000 photo, 1:1 crop => every 1% of width costs 1.33% of height,
    // because the image is wider than it is tall.
    const k = aspectRatioInPercent({
      naturalHeight: 3000,
      naturalWidth: 4000,
      ratio: 1,
    });
    expect(k).toBeCloseTo(4000 / 3000, 6);

    // 60% x 80% of a 4:3 image is a square: 2400px on both sides.
    const heightPct = heightFor(60, k as number);
    expect(heightPct).toBeCloseTo(80, 6);
    expect((60 / 100) * 4000).toBeCloseTo((heightPct / 100) * 3000, 6);
  });

  test("returns null without a ratio or dimensions", () => {
    expect(
      aspectRatioInPercent({ naturalHeight: 0, naturalWidth: 0, ratio: 1 })
    ).toBeNull();
    expect(
      aspectRatioInPercent({
        naturalHeight: 100,
        naturalWidth: 100,
        ratio: null,
      })
    ).toBeNull();
    expect(
      aspectRatioInPercent({ naturalHeight: 100, naturalWidth: 100, ratio: 0 })
    ).toBeNull();
  });
});

test.describe("boxForAspect", () => {
  test("produces a centred 80% box for a free crop", () => {
    expect(boxForAspect(null)).toEqual({
      height: 80,
      width: 80,
      x: 10,
      y: 10,
    });
  });

  test("keeps the ratio and stays inside the frame when the aspect is tall", () => {
    // Tall ratio: 9:16 on a square image => k = 16/9.
    const k = 16 / 9;
    const box = boxForAspect(k);

    expect(box.width / box.height).toBeCloseTo(1 / k, 6);
    expect(box.height).toBeLessThanOrEqual(80);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    expect(box.x + box.width).toBeLessThanOrEqual(100);
    expect(box.width).toBeCloseTo(80 / k, 6);
  });
});

test.describe("fullCropBox", () => {
  test("covers the whole image", () => {
    expect(fullCropBox()).toEqual({ height: 100, width: 100, x: 0, y: 0 });
  });
});

test.describe("clampCropBox", () => {
  test("keeps the box inside the frame", () => {
    expect(clampCropBox({ height: 50, width: 50, x: 90, y: -20 })).toEqual({
      height: 50,
      width: 50,
      x: 50,
      y: 0,
    });
  });

  test("enforces a minimum size", () => {
    const box = clampCropBox({ height: 1, width: 1, x: 10, y: 10 });
    expect(box.width).toBe(MIN_CROP_PCT);
    expect(box.height).toBe(MIN_CROP_PCT);
  });
});

test.describe("applyCropDrag — freeform", () => {
  const start: CropBox = { height: 50, width: 50, x: 25, y: 25 };

  test("moves the box and clamps it to the frame", () => {
    const moved = applyCropDrag({
      aspectK: null,
      dx: 100,
      dy: 100,
      handle: "move",
      initial: start,
    });
    expect(moved).toEqual({ height: 50, width: 50, x: 50, y: 50 });

    const back = applyCropDrag({
      aspectK: null,
      dx: -100,
      dy: -100,
      handle: "move",
      initial: start,
    });
    expect(back).toEqual({ height: 50, width: 50, x: 0, y: 0 });
  });

  test("grows from the south-east corner", () => {
    const next = applyCropDrag({
      aspectK: null,
      dx: 10,
      dy: 20,
      handle: "se",
      initial: start,
    });
    expect(next.x).toBe(25);
    expect(next.y).toBe(25);
    expect(next.width).toBeCloseTo(60, 6);
    expect(next.height).toBeCloseTo(70, 6);
  });

  test("shrinks from the north-west corner, anchoring the opposite edge", () => {
    const next = applyCropDrag({
      aspectK: null,
      dx: 10,
      dy: 10,
      handle: "nw",
      initial: start,
    });
    expect(next.x).toBeCloseTo(35, 6);
    expect(next.y).toBeCloseTo(35, 6);
    expect(next.width).toBeCloseTo(40, 6);
    expect(next.height).toBeCloseTo(40, 6);
    expect(next.x + next.width).toBeCloseTo(75, 6);
    expect(next.y + next.height).toBeCloseTo(75, 6);
  });

  test("resizes from a single edge only", () => {
    const next = applyCropDrag({
      aspectK: null,
      dx: 12,
      dy: 0,
      handle: "e",
      initial: start,
    });
    expect(next.x).toBe(25);
    expect(next.y).toBe(25);
    expect(next.width).toBeCloseTo(62, 6);
    expect(next.height).toBeCloseTo(50, 6);
  });

  test("cannot be dragged below the minimum size", () => {
    const next = applyCropDrag({
      aspectK: null,
      dx: -100,
      dy: -100,
      handle: "se",
      initial: start,
    });
    expect(next.width).toBe(MIN_CROP_PCT);
    expect(next.height).toBe(MIN_CROP_PCT);
  });
});

test.describe("applyCropDrag — aspect locked", () => {
  const start: CropBox = { height: 50, width: 50, x: 25, y: 25 };
  // Square crop on a 4:3 image: height% = width% * (4/3).
  const k = 4 / 3;

  test("keeps the ratio when dragging a corner", () => {
    const next = applyCropDrag({
      aspectK: k,
      dx: 10,
      dy: 0,
      handle: "se",
      initial: start,
    });
    expect(next.width / next.height).toBeCloseTo(1 / k, 6);
    // The anchored top-left corner stays put horizontally...
    expect(next.x).toBe(25);
    // ...and the box is pushed up rather than overflowing the bottom edge.
    expect(next.y + next.height).toBeCloseTo(100, 6);
    expect(next.y).toBeCloseTo(20, 6);
  });

  test("anchors the opposite corner when dragging north-west", () => {
    const next = applyCropDrag({
      aspectK: k,
      dx: 10,
      dy: 0,
      handle: "nw",
      initial: start,
    });
    expect(next.width / next.height).toBeCloseTo(1 / k, 6);
    expect(next.x + next.width).toBeCloseTo(75, 6);
    expect(next.y + next.height).toBeCloseTo(75, 6);
  });

  test("grows symmetrically from an edge handle", () => {
    const next = applyCropDrag({
      aspectK: k,
      dx: 10,
      dy: 0,
      handle: "e",
      initial: start,
    });
    expect(next.width / next.height).toBeCloseTo(1 / k, 6);
    // Vertical centre is preserved for edge drags.
    expect(next.y + next.height / 2).toBeCloseTo(50, 6);
  });

  test("stays inside the frame and keeps the ratio when huge", () => {
    const next = applyCropDrag({
      aspectK: k,
      dx: 500,
      dy: 500,
      handle: "se",
      initial: start,
    });
    expect(next.width / next.height).toBeCloseTo(1 / k, 6);
    expect(next.x + next.width).toBeLessThanOrEqual(100.000_001);
    expect(next.y + next.height).toBeLessThanOrEqual(100.000_001);
  });
});
