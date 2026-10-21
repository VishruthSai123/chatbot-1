import { expect, test } from "@playwright/test";

import {
  collageLayout,
  overlayPosition,
  stitchLayout,
} from "../../lib/image/composite-layout";

test.describe("stitch layout", () => {
  test("a vertical stitch is as wide as the widest image", () => {
    const layout = stitchLayout({
      direction: "vertical",
      sizes: [
        { height: 50, width: 100 },
        { height: 80, width: 60 },
      ],
    });

    expect(layout.width).toBe(100);
    expect(layout.height).toBe(130);
  });

  test("a horizontal stitch is as tall as the tallest image", () => {
    const layout = stitchLayout({
      direction: "horizontal",
      sizes: [
        { height: 50, width: 100 },
        { height: 80, width: 60 },
      ],
    });

    expect(layout.width).toBe(160);
    expect(layout.height).toBe(80);
  });

  test("a gap is added between images, not around them", () => {
    const layout = stitchLayout({
      direction: "vertical",
      gap: 10,
      sizes: [
        { height: 50, width: 100 },
        { height: 80, width: 60 },
      ],
    });

    expect(layout.height).toBe(50 + 80 + 10);
  });

  test("a smaller image is centred rather than scaled up", () => {
    const layout = stitchLayout({
      direction: "vertical",
      sizes: [
        { height: 50, width: 100 },
        { height: 80, width: 60 },
      ],
    });

    // The 60px-wide image sits in the middle of a 100px canvas.
    expect(layout.layers[1].left).toBe(20);
    expect(layout.layers[1].top).toBe(50);
  });

  test("a horizontal stitch offsets each image along the x axis", () => {
    const layout = stitchLayout({
      direction: "horizontal",
      sizes: [
        { height: 50, width: 100 },
        { height: 80, width: 60 },
      ],
    });

    expect(layout.layers[0].left).toBe(0);
    expect(layout.layers[1].left).toBe(100);
  });

  test("an empty list produces an empty canvas", () => {
    const layout = stitchLayout({ sizes: [] });

    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
    expect(layout.layers).toHaveLength(0);
  });

  test("a negative gap is treated as no gap", () => {
    const layout = stitchLayout({
      direction: "vertical",
      gap: -20,
      sizes: [
        { height: 50, width: 10 },
        { height: 30, width: 10 },
      ],
    });

    expect(layout.height).toBe(80);
  });
});

test.describe("collage layout", () => {
  test("a square grid is the default", () => {
    const layout = collageLayout({ cellHeight: 100, count: 4, gap: 0 });

    expect(layout.columnCount).toBe(2);
    expect(layout.rowCount).toBe(2);
    expect(layout.width).toBe(200);
    expect(layout.height).toBe(200);
  });

  test("the gap sits between cells only", () => {
    const layout = collageLayout({ cellHeight: 100, count: 4, gap: 5 });

    expect(layout.width).toBe(2 * 100 + 5);
    expect(layout.height).toBe(2 * 100 + 5);
  });

  test("an explicit column count is honoured", () => {
    const layout = collageLayout({
      cellHeight: 100,
      columns: 3,
      count: 5,
      gap: 0,
    });

    expect(layout.columnCount).toBe(3);
    expect(layout.rowCount).toBe(2);
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(200);
  });

  test("there are never more columns than images", () => {
    const layout = collageLayout({ cellHeight: 100, count: 2, gap: 0 });

    expect(layout.columnCount).toBe(2);
    expect(layout.rowCount).toBe(1);
  });

  test("a single image still produces one cell", () => {
    const layout = collageLayout({ cellHeight: 80, count: 1, gap: 10 });

    expect(layout.columnCount).toBe(1);
    expect(layout.rowCount).toBe(1);
    expect(layout.width).toBe(80);
    expect(layout.height).toBe(80);
  });
});

test.describe("overlay position", () => {
  const base = { height: 200, width: 400 };
  const overlay = { height: 50, width: 100 };

  test("the corners anchor to the canvas", () => {
    expect(overlayPosition({ base, overlay, position: "top-left" })).toEqual({
      left: 0,
      top: 0,
    });
    expect(overlayPosition({ base, overlay, position: "top-right" })).toEqual({
      left: 300,
      top: 0,
    });
    expect(overlayPosition({ base, overlay, position: "bottom-left" })).toEqual(
      { left: 0, top: 150 }
    );
    expect(
      overlayPosition({ base, overlay, position: "bottom-right" })
    ).toEqual({ left: 300, top: 150 });
  });

  test("the centre is centred", () => {
    expect(overlayPosition({ base, overlay, position: "center" })).toEqual({
      left: 150,
      top: 75,
    });
  });

  test("the default is the bottom right", () => {
    expect(overlayPosition({ base, overlay })).toEqual({ left: 300, top: 150 });
  });
});
