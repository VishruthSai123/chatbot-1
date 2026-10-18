import { expect, test } from "@playwright/test";

import {
  alphaBounds,
  applyAlphaRamp,
  blurAlpha,
  boxBlur,
  decontaminate,
  expandBounds,
  hexToRgb,
  refineAlpha,
  toAlphaBytes,
  toAlphaFloats,
} from "../../lib/image/alpha";

/** A deliberately soft matte straddling an edge, as the model produces. */
function softMatte(width: number, height: number, edge: number): Float32Array {
  const alpha = new Float32Array(width * height);
  const half = 8;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = Math.min(
        1,
        Math.max(0, (x - (edge - half)) / (half * 2))
      );
    }
  }
  return alpha;
}

function transitionWidth(alpha: Float32Array, width: number): number {
  let count = 0;
  for (let i = 0; i < width; i += 1) {
    if (alpha[i] > 0.05 && alpha[i] < 0.95) {
      count += 1;
    }
  }
  return count;
}

/** Index of the sample closest to 0.5 — the edge a viewer perceives. */
function crossing(values: Float32Array, width: number): number {
  let best = 0;
  for (let i = 1; i < width; i += 1) {
    if (Math.abs(values[i] - 0.5) < Math.abs(values[best] - 0.5)) {
      best = i;
    }
  }
  return best;
}

test.describe("boxBlur", () => {
  test("spreads a single bright pixel over its window", () => {
    const blurred = boxBlur(new Float32Array([0, 0, 1, 0, 0]), 5, 1, 1);

    expect(blurred).toEqual(new Float32Array([0, 1 / 3, 1 / 3, 1 / 3, 0]));
  });

  test("leaves a flat field untouched", () => {
    const flat = new Float32Array(12).fill(0.4);

    expect(boxBlur(flat, 4, 3, 2)).toEqual(flat);
  });

  test("is a no-op for a zero radius", () => {
    const source = new Float32Array([0.1, 0.9]);

    expect(boxBlur(source, 2, 1, 0)).toEqual(source);
  });
});

test.describe("applyAlphaRamp", () => {
  test("keeps the midpoint and clamps the extremes", () => {
    const ramped = applyAlphaRamp(
      new Float32Array([0, 0.2, 0.5, 0.8, 1]),
      0.3,
      0.7
    );

    expect(ramped[0]).toBe(0);
    expect(ramped[1]).toBe(0);
    expect(ramped[2]).toBeCloseTo(0.5, 5);
    expect(ramped[3]).toBe(1);
    expect(ramped[4]).toBe(1);
  });
});

test.describe("blurAlpha", () => {
  test("feathers a hard edge without moving it", () => {
    const hard = new Float32Array(21);
    for (let i = 10; i < 21; i += 1) {
      hard[i] = 1;
    }

    const feathered = blurAlpha(hard, 21, 1, 0.9);

    expect(feathered[9]).toBeGreaterThan(0);
    expect(feathered[9]).toBeLessThan(1);
    expect(feathered[10]).toBeLessThan(1);
  });
});

test.describe("refineAlpha", () => {
  test("sharpens the matte without moving the silhouette", () => {
    const width = 64;
    const height = 4;
    const soft = softMatte(width, height, 32);

    const crisp = refineAlpha({ alpha: soft, edgeSmoothing: 0, height, width });
    const smooth = refineAlpha({
      alpha: soft,
      edgeSmoothing: 100,
      height,
      width,
    });

    expect(transitionWidth(crisp, width)).toBeLessThan(
      transitionWidth(soft, width)
    );
    expect(transitionWidth(crisp, width)).toBeLessThanOrEqual(
      transitionWidth(smooth, width)
    );
    // The perceived edge is the 0.5 crossing: sharpening must not move it.
    expect(
      Math.abs(crossing(crisp, width) - crossing(soft, width))
    ).toBeLessThanOrEqual(1);
    for (const value of crisp) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("is monotonic, so no ringing halo can appear", () => {
    const width = 64;
    const alpha = softMatte(width, 2, 32);
    const crisp = refineAlpha({ alpha, edgeSmoothing: 0, height: 2, width });

    for (let i = 1; i < width; i += 1) {
      expect(crisp[i]).toBeGreaterThanOrEqual(crisp[i - 1] - 1e-6);
    }
  });
});

test.describe("alphaBounds", () => {
  test("measures the opaque region", () => {
    const alpha = new Float32Array(16);
    alpha[5] = 1;
    alpha[6] = 1;
    alpha[9] = 1;
    alpha[10] = 1;

    expect(alphaBounds(alpha, 4, 4)).toEqual({
      bottom: 2,
      left: 1,
      right: 2,
      top: 1,
    });
  });

  test("ignores noise below the threshold", () => {
    const alpha = new Float32Array(16);
    alpha[0] = 0.01;
    alpha[15] = 1;

    expect(alphaBounds(alpha, 4, 4)).toEqual({
      bottom: 3,
      left: 3,
      right: 3,
      top: 3,
    });
  });

  test("reports an empty matte as null", () => {
    expect(alphaBounds(new Float32Array(16), 4, 4)).toBeNull();
  });
});

test.describe("expandBounds", () => {
  test("pads the box and stays inside the image", () => {
    expect(
      expandBounds({ bottom: 2, left: 1, right: 2, top: 1 }, 1, 4, 4)
    ).toEqual({ bottom: 3, left: 0, right: 3, top: 0 });
  });

  test("clamps at the far edge", () => {
    expect(
      expandBounds({ bottom: 3, left: 3, right: 3, top: 3 }, 8, 4, 4)
    ).toEqual({ bottom: 3, left: 0, right: 3, top: 0 });
  });
});

test.describe("decontaminate", () => {
  const FOREGROUND = [200, 50, 25];
  const BACKGROUND = [255, 255, 255];
  const ALPHA = 0.5;

  test("recovers the foreground colour from a semi-transparent edge", () => {
    const observed = new Uint8Array(
      FOREGROUND.map((channel, index) =>
        Math.round(channel * ALPHA + BACKGROUND[index] * (1 - ALPHA))
      )
    );

    const cleaned = decontaminate(observed, new Float32Array([ALPHA]), 1, 1, {
      b: BACKGROUND[2],
      g: BACKGROUND[1],
      r: BACKGROUND[0],
    });

    for (let c = 0; c < 3; c += 1) {
      expect(Math.abs(cleaned[c] - FOREGROUND[c])).toBeLessThanOrEqual(2);
    }
  });

  test("leaves opaque pixels alone and paints transparent ones with the fill", () => {
    const rgb = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const cleaned = decontaminate(rgb, new Float32Array([1, 0]), 2, 1, {
      b: 255,
      g: 255,
      r: 255,
    });

    expect(Array.from(cleaned.subarray(0, 3))).toEqual([10, 20, 30]);
    expect(Array.from(cleaned.subarray(3, 6))).toEqual([255, 255, 255]);
  });

  test("refuses a matte that is smaller than the image", () => {
    expect(() =>
      decontaminate(new Uint8Array(6), new Float32Array(1), 2, 1, {
        b: 0,
        g: 0,
        r: 0,
      })
    ).toThrow(/smaller/);
  });
});

test.describe("alpha conversion", () => {
  test("clamps and rounds when packing to bytes", () => {
    expect(
      Array.from(toAlphaBytes(new Float32Array([-1, 0.5, 0.001, 2])))
    ).toEqual([0, 128, 0, 255]);
  });

  test("round-trips through floats", () => {
    const floats = toAlphaFloats(toAlphaBytes(new Float32Array([0, 0.5, 1])));

    expect(floats[0]).toBe(0);
    expect(floats[1]).toBeCloseTo(128 / 255, 6);
    expect(floats[2]).toBe(1);
  });
});

test.describe("hexToRgb", () => {
  test("parses long and short forms", () => {
    expect(hexToRgb("#ff8800")).toEqual({ b: 0, g: 136, r: 255 });
    expect(hexToRgb("#f80")).toEqual({ b: 0, g: 136, r: 255 });
    expect(hexToRgb("ffffff")).toEqual({ b: 255, g: 255, r: 255 });
  });

  test("degrades to black instead of NaN", () => {
    expect(hexToRgb("nope")).toEqual({ b: 0, g: 0, r: 0 });
  });
});
