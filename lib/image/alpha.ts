/**
 * Pure alpha-matte helpers used by background removal.
 *
 * The segmentation model predicts a matte at a fixed 1024x1024 and that matte is
 * resampled back up to the photo's resolution, which leaves soft, slightly milky
 * edges. Everything in this file cleans that matte up on the CPU, with no native
 * dependencies, so it is cheap to unit test:
 *
 * - {@link applyAlphaRamp} squeezes the alpha band through a smoothstep. A matte
 *   that fades in over twenty pixels becomes a crisp cut with the same silhouette,
 *   because the 0.5 crossing — the edge a viewer actually sees — never moves.
 * - {@link blurAlpha} re-introduces a sub-pixel feather so the resulting cut stays
 *   anti-aliased instead of turning into stair steps.
 * - {@link decontaminate} removes the original background colour that bleeds into
 *   semi-transparent edge pixels, which is what causes fringing when a cutout is
 *   composited onto a solid colour such as passport white.
 */

const ALPHA_SCALE = 255;
const RGB_STRIDE = 3;
/** Alpha ramp band at the crispest setting: a narrow, still anti-aliased edge. */
const RAMP_BAND_MIN = 0.3;
/** Alpha ramp band at the softest setting: keeps deliberately gradual edges. */
const RAMP_BAND_MAX = 0.7;
/** Feather radius, in pixels, at the crispest setting. */
const FEATHER_MIN = 0.3;
/** Extra feather radius, in pixels, added by the softest setting. */
const FEATHER_RANGE = 1.1;
/** Blurs below this sigma are not worth the pass. */
const FEATHER_FLOOR = 0.05;

export interface AlphaBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface RefineAlphaOptions {
  /** Predicted matte, 0..1 per pixel, `width * height` entries. */
  alpha: Float32Array;
  /** 0 = crisp edge transition, 100 = soft feathered transition. */
  edgeSmoothing: number;
  height: number;
  width: number;
}

export interface RgbColor {
  b: number;
  g: number;
  r: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/** Nearest-edge index, so blurs never shrink the working area. */
function clampIndex(index: number, size: number): number {
  if (index < 0) {
    return 0;
  }
  if (index >= size) {
    return size - 1;
  }
  return index;
}

/** Convert 0..1 floats to the 8-bit single-channel matte stored in documents. */
export function toAlphaBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.round(clamp(values[i], 0, 1) * ALPHA_SCALE);
  }
  return out;
}

/** Convert an 8-bit single-channel matte to 0..1 floats. */
export function toAlphaFloats(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] / ALPHA_SCALE;
  }
  return out;
}

/**
 * Separable box blur with a sliding window sum — O(pixels), independent of radius.
 * The building block for the feather.
 */
export function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const size = width * height;
  if (radius < 1) {
    return src.slice();
  }

  const window = radius * 2 + 1;
  const horizontal = new Float32Array(size);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += src[row + clampIndex(x, width)];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      sum -= src[row + clampIndex(x - radius, width)];
      sum += src[row + clampIndex(x + radius + 1, width)];
    }
  }

  const out = new Float32Array(size);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += horizontal[clampIndex(y, height) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum -= horizontal[clampIndex(y - radius, height) * width + x];
      sum += horizontal[clampIndex(y + radius + 1, height) * width + x];
    }
  }
  return out;
}

/**
 * Push the matte through a smoothstep between `low` and `high`.
 *
 * The 0.5 crossing — and therefore the perceived silhouette — is preserved while
 * the foggy "maybe" band around it collapses onto either fully inside or fully
 * outside, which is what turns a smeared model edge into a crisp cutout.
 */
export function applyAlphaRamp(
  alpha: Float32Array,
  low: number,
  high: number
): Float32Array {
  const span = Math.max(high - low, Number.EPSILON);
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const t = clamp((alpha[i] - low) / span, 0, 1);
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/** Sub-pixel feather: two box passes approximate a small gaussian closely enough. */
export function blurAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  sigma: number
): Float32Array {
  const maxRadius = Math.max(1, Math.floor(Math.min(width, height) / 4));
  if (sigma <= FEATHER_FLOOR) {
    return alpha.slice();
  }
  const radius = clamp(Math.round(sigma * 1.5), 1, maxRadius);
  return boxBlur(boxBlur(alpha, width, height, radius), width, height, radius);
}

/**
 * Full matte clean-up: squeeze the edge band, then feather it back to a sub-pixel
 * anti-aliased transition. `edgeSmoothing` runs from 0 (crisp: logos, products) to
 * 100 (soft: hair, fur), and both constants scale with it so the two never fight.
 */
export function refineAlpha({
  alpha,
  edgeSmoothing,
  height,
  width,
}: RefineAlphaOptions): Float32Array {
  const smooth = clamp(edgeSmoothing / 100, 0, 1);
  const mid = 0.5;
  const band = (RAMP_BAND_MIN + (RAMP_BAND_MAX - RAMP_BAND_MIN) * smooth) / 2;
  const ramped = applyAlphaRamp(alpha, mid - band, mid + band);
  return blurAlpha(ramped, width, height, FEATHER_MIN + FEATHER_RANGE * smooth);
}

/**
 * Bounding box of everything the matte considers opaque, or `null` for an empty
 * matte. Coordinates are inclusive pixel indices.
 */
export function alphaBounds(
  alpha: Float32Array,
  width: number,
  height: number,
  threshold = 0.02
): AlphaBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[row + x] > threshold) {
        if (x < left) {
          left = x;
        }
        if (x > right) {
          right = x;
        }
        if (y < top) {
          top = y;
        }
        if (y > bottom) {
          bottom = y;
        }
      }
    }
  }

  if (right < 0 || bottom < 0) {
    return null;
  }
  return { bottom, left, right, top };
}

/**
 * Grow a bounding box by `padding` pixels and keep it inside the image, so an
 * auto-cropped subject never touches the frame.
 */
export function expandBounds(
  bounds: AlphaBounds,
  padding: number,
  width: number,
  height: number
): AlphaBounds {
  const left = clamp(bounds.left - padding, 0, width - 1);
  const top = clamp(bounds.top - padding, 0, height - 1);
  const right = clamp(bounds.right + padding, left, width - 1);
  const bottom = clamp(bounds.bottom + padding, top, height - 1);
  return { bottom, left, right, top };
}

/**
 * Undo background bleed on semi-transparent pixels.
 *
 * A rendered pixel is `foreground * alpha + background * (1 - alpha)`. When the
 * background colour is known (solid-colour mode) the foreground can be solved for
 * exactly, which removes the light/dark fringe that otherwise shows up as a halo
 * around hair once the cutout sits on the new colour.
 */
export function decontaminate(
  rgb: Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  background: RgbColor
): Uint8Array {
  const pixelCount = width * height;
  if (alpha.length < pixelCount) {
    throw new Error("Matte is smaller than the image it belongs to.");
  }

  const channels = [background.r, background.g, background.b];
  const out = new Uint8Array(pixelCount * RGB_STRIDE);
  for (let i = 0; i < pixelCount; i += 1) {
    const a = alpha[i];
    const base = i * RGB_STRIDE;
    if (a >= 0.995) {
      out[base] = rgb[base];
      out[base + 1] = rgb[base + 1];
      out[base + 2] = rgb[base + 2];
      continue;
    }
    // Fully transparent pixels are pure background; matching the fill colour keeps
    // them invisible instead of producing a dark rim.
    if (a <= 0.02) {
      out[base] = channels[0];
      out[base + 1] = channels[1];
      out[base + 2] = channels[2];
      continue;
    }
    const inverse = 1 - a;
    const divisor = Math.max(a, 0.05);
    for (let c = 0; c < RGB_STRIDE; c += 1) {
      const solved = (rgb[base + c] - channels[c] * inverse) / divisor;
      out[base + c] = clamp(Math.round(solved), 0, ALPHA_SCALE);
    }
  }
  return out;
}

/**
 * Parse a `#rgb` or `#rrggbb` fill colour into 0..255 channels. Invalid input
 * degrades to black rather than `NaN`, which would poison the whole buffer.
 */
export function hexToRgb(hex: string): RgbColor {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
      : value.padEnd(6, "0");
  return {
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
  };
}
