/**
 * Unified image geometry resolution.
 *
 * Single source of truth for turning any dimension request — exact pixels,
 * physical units + DPI, aspect ratio, relative scale, bounded fit, or a named
 * preset — into concrete pixel dimensions the sharp engine can apply.
 *
 * This module is intentionally PURE (no sharp, no server-only, no IO) so it can be
 * unit-tested and reused by the AI tools, the API route, and the inspectors.
 */

import {
  type DpiOption,
  getPresetByKey,
  type PhysicalUnit,
  physicalToPixels,
} from "./presets";

export type DimensionUnit = PhysicalUnit; // "px" | "cm" | "mm" | "in"
export type DimensionDpi = DpiOption; // 72 | 150 | 300 | 600
export type DimensionFit =
  | "cover"
  | "contain"
  | "fill"
  | "inside"
  | "outside"
  | "pad";

/**
 * A single, flexible description of any requested output geometry. Callers only
 * need to fill the fields relevant to their mode; the resolver figures out the rest.
 */
export interface DimensionSpec {
  /** When false, the image is never enlarged beyond its source size. Default true. */
  allowUpscale?: boolean;
  /** Target aspect ratio, e.g. "16:9", "4:5", "1:1", "square", or "1.78". */
  aspectRatio?: string;
  /** Target DPI (physical units + density embedding). Default 300. */
  dpi?: DimensionDpi;
  /** Resize fit strategy. "pad" letterboxes with padColor. Default "cover". */
  fit?: DimensionFit;
  /** Exact target height (in `unit`). */
  height?: number;
  /** Upper bound for height, preserving aspect ratio (niche, usually use maxLongEdge). */
  maxHeight?: number;
  /** Longest edge is clamped to this many pixels, preserving aspect ratio. */
  maxLongEdge?: number;
  /** Upper bound for width, preserving aspect ratio. */
  maxWidth?: number;
  /** Lower bound for height, preserving aspect ratio. */
  minHeight?: number;
  /** Lower bound for width, preserving aspect ratio. */
  minWidth?: number;
  /** Hex fill colour used when fit is "pad" (or contain on JPEG). Default "#ffffff". */
  padColor?: string;
  /** Named preset key (e.g. "indian_passport"). Explicit fields override it. */
  preset?: string;
  /** Relative scale, e.g. 50 (half), 200 (double). */
  scalePercent?: number;
  /** Optional maximum file size (KB) applied after geometry. */
  targetSizeKb?: number;
  /** Unit for width/height. Default "px". */
  unit?: DimensionUnit;
  /** Exact target width (in `unit`). */
  width?: number;
}

export interface SourceGeometry {
  height: number;
  width: number;
}

export interface ResolvedGeometry {
  dpi: number;
  fit: DimensionFit;
  height: number;
  padColor?: string;
  /** Actual multiplier from source to target (useful for the UI). */
  scaleFactor: number;
  targetSizeKb?: number;
  width: number;
}

const DEFAULT_DPI: DimensionDpi = 300;
const DEFAULT_FIT: DimensionFit = "cover";
const MAX_DIMENSION = 20_000; // sane ceiling so nobody requests a 1e9 px canvas

/**
 * Parse an aspect ratio from "16:9", "16/9", "16x9", "square", or a plain number.
 * Returns width/height (> 0) or null when unparseable.
 */
export function parseAspectRatio(
  input: string | number | null | undefined
): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? input : null;
  }
  const raw = input.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === "square") {
    return 1;
  }
  // N:B, N/B or NxB
  const ratioMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/);
  if (ratioMatch) {
    const w = Number(ratioMatch[1]);
    const h = Number(ratioMatch[2]);
    if (w > 0 && h > 0) {
      return w / h;
    }
    return null;
  }
  // Plain decimal like "1.78" or "16:9" already handled above
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPixels(
  value: number,
  unit: DimensionUnit,
  dpi: DimensionDpi
): number {
  return Math.max(1, physicalToPixels(value, unit, dpi));
}

/**
 * Resolve a {@link DimensionSpec} plus the source image size into concrete target
 * pixel geometry. Deterministic and side-effect free.
 */
export function resolveTargetGeometry(
  spec: DimensionSpec,
  source: SourceGeometry
): ResolvedGeometry {
  const srcWidth = Math.max(1, Math.round(source.width));
  const srcHeight = Math.max(1, Math.round(source.height));

  // ── 1. Seed from a named preset (explicit fields below still win) ──────────
  const {
    allowUpscale = true,
    aspectRatio,
    maxHeight,
    maxLongEdge,
    maxWidth,
    minHeight,
    minWidth,
    preset,
    scalePercent,
    targetSizeKb,
  } = spec;
  const presetDef = preset ? getPresetByKey(preset) : undefined;
  let {
    dpi = presetDef?.dpi ?? DEFAULT_DPI,
    fit = DEFAULT_FIT,
    height = presetDef?.height,
    padColor,
    unit = presetDef?.unit ?? "px",
    width = presetDef?.width,
  } = spec;

  // ── 2. Compute the base target box ────────────────────────────────────────
  let targetWidth: number;
  let targetHeight: number;

  if (scalePercent !== undefined && scalePercent > 0) {
    // Relative scaling preserves the source aspect exactly.
    targetWidth = Math.round((srcWidth * scalePercent) / 100);
    targetHeight = Math.round((srcHeight * scalePercent) / 100);
  } else if (
    width !== undefined &&
    width > 0 &&
    height !== undefined &&
    height > 0
  ) {
    targetWidth = toPixels(width, unit, dpi);
    targetHeight = toPixels(height, unit, dpi);
  } else if (width !== undefined && width > 0) {
    targetWidth = toPixels(width, unit, dpi);
    const ratio =
      parseAspectRatio(aspectRatio) ?? srcWidth / Math.max(1, srcHeight);
    targetHeight = Math.round(targetWidth / ratio);
  } else if (height !== undefined && height > 0) {
    targetHeight = toPixels(height, unit, dpi);
    const ratio =
      parseAspectRatio(aspectRatio) ?? srcWidth / Math.max(1, srcHeight);
    targetWidth = Math.round(targetHeight * ratio);
  } else if (parseAspectRatio(aspectRatio) === null) {
    // Nothing requested → identity (caller may still apply bounds below).
    targetWidth = srcWidth;
    targetHeight = srcHeight;
  } else {
    // Aspect-ratio-only: keep the source's longest edge, derive the other.
    const ratio = parseAspectRatio(aspectRatio) as number;
    if (srcWidth >= srcHeight) {
      targetWidth = srcWidth;
      targetHeight = Math.round(srcWidth / ratio);
    } else {
      targetHeight = srcHeight;
      targetWidth = Math.round(srcHeight * ratio);
    }
  }

  // ── 3. Honour an explicit aspect ratio when both dims were given ───────────
  if (
    aspectRatio !== undefined &&
    width !== undefined &&
    height !== undefined &&
    scalePercent === undefined
  ) {
    const ratio = parseAspectRatio(aspectRatio);
    if (ratio !== null) {
      // Preserve the requested width and derive height to satisfy the ratio.
      targetHeight = Math.round(targetWidth / ratio);
    }
  }

  // ── 4. Apply bounds, preserving aspect ratio ──────────────────────────────
  const applyScale = (factor: number) => {
    targetWidth = Math.max(1, Math.round(targetWidth * factor));
    targetHeight = Math.max(1, Math.round(targetHeight * factor));
  };

  if (maxLongEdge && maxLongEdge > 0) {
    const longest = Math.max(targetWidth, targetHeight);
    if (longest > maxLongEdge) {
      applyScale(maxLongEdge / longest);
    }
  }
  if (maxWidth && targetWidth > maxWidth) {
    applyScale(maxWidth / targetWidth);
  }
  if (maxHeight && targetHeight > maxHeight) {
    applyScale(maxHeight / targetHeight);
  }
  if (minWidth && targetWidth < minWidth) {
    applyScale(minWidth / targetWidth);
  }
  if (minHeight && targetHeight < minHeight) {
    applyScale(minHeight / targetHeight);
  }

  // ── 5. Never enlarge when disallowed ──────────────────────────────────────
  if (!allowUpscale) {
    const shrink = Math.min(
      srcWidth / targetWidth,
      srcHeight / targetHeight,
      1
    );
    if (shrink < 1) {
      applyScale(shrink);
    }
  }

  // ── 6. Clamp + finalise ───────────────────────────────────────────────────
  targetWidth = clamp(Math.round(targetWidth), 1, MAX_DIMENSION);
  targetHeight = clamp(Math.round(targetHeight), 1, MAX_DIMENSION);

  switch (fit) {
    case "pad":
      // "pad" is our alias for letterboxing with a background colour.
      padColor = padColor ?? "#ffffff";
      break;
    case "contain":
    case "inside":
    case "outside":
      // Keep any caller-provided colour; the engine handles transparency.
      break;
    default:
      padColor = undefined;
  }

  const scaleFactor = Math.round((targetWidth / srcWidth) * 1000) / 1000 || 1;

  return {
    dpi,
    fit,
    height: targetHeight,
    padColor,
    scaleFactor,
    targetSizeKb,
    width: targetWidth,
  };
}

/**
 * Human-readable one-liner for prompts, tool cards, and toasts.
 */
export function describeGeometry(g: ResolvedGeometry): string {
  const pad = g.padColor ? `, padded ${g.padColor}` : "";
  return `${g.width}×${g.height} px @ ${g.dpi} DPI (${g.fit}${pad})`;
}
