/**
 * Deterministic natural-language → image requirement parsing.
 *
 * Turns a user's sentence ("passport photo 35x45mm at 300 dpi, under 50KB") into
 * a partial {@link DimensionSpec} with NO model involved. This is used two ways:
 *   1. As a high-signal hint injected into the system prompt so the model fills
 *      the right tool fields on the first try.
 *   2. To repair/complete the model's tool arguments (fill gaps, fix a unit that
 *      silently defaulted to px when the user asked for mm/cm/in).
 *
 * Intentionally PURE (no sharp, no server-only, no IO) so it can be unit-tested
 * and shared by the chat route and the workbench UI.
 */

import type { DimensionDpi, DimensionSpec } from "./dimensions";
import { getPresetByKey } from "./presets";

export interface ParsedRequirement {
  /** Human-readable list of the substrings that were recognised. */
  matched: string[];
  /** Fields confidently extracted from the text. Empty when nothing matched. */
  spec: Partial<DimensionSpec>;
}

const DPI_VALUES: DimensionDpi[] = [72, 150, 300, 600];

/** Snap an arbitrary DPI to the nearest value the engine supports. */
function snapDpi(value: number): DimensionDpi {
  return DPI_VALUES.reduce((best, dpi) =>
    Math.abs(dpi - value) < Math.abs(best - value) ? dpi : best
  );
}

type PhysicalUnitName = "cm" | "in" | "mm";

function normalizeUnit(token: string): PhysicalUnitName {
  const clean = token.trim().toLowerCase();
  if (clean === "cm") {
    return "cm";
  }
  if (clean === '"' || clean.startsWith("inch") || clean === "in") {
    return "in";
  }
  return "mm";
}

const PRESET_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "us_green_card", re: /green\s*card|uscis|permanent\s+resident/ },
  { key: "indian_passport", re: /indian?\s+passport|\boci\b/ },
  { key: "us_visa", re: /us\s+(?:visa|passport)|american\s+(?:visa|passport)/ },
  {
    key: "india_evisa",
    re: /(?:india|indian)\s+e-?visa|e-?visa\s+(?:for\s+)?india/,
  },
  { key: "china_visa", re: /chin(?:a|ese)\s+visa/ },
  { key: "japan_visa", re: /japan(?:ese)?\s+visa/ },
  { key: "canada_visa", re: /canad(?:a|ian)\s+visa/ },
  { key: "uae_visa", re: /(?:uae|emirat(?:es)?|dubai)\s+visa/ },
  { key: "schengen_visa", re: /schengen/ },
  {
    key: "uk_visa",
    re: /(?:uk|british|united\s+kingdom|australia|australian|new\s+zealand)\s+(?:visa|passport)/,
  },
  { key: "pan_card", re: /\bpan\s+card\b/ },
  { key: "stamp_size", re: /\bstamp\s+size\b/ },
  { key: "photo_4x6", re: /\b4\s*(?:x|×|by)\s*6\b/ },
  {
    key: "passport_photo",
    re: /\bpassport\s+(?:photo|size|sized)\b|\bpassport\b/,
  },
];

/**
 * Parse a natural-language image request into a partial {@link DimensionSpec}.
 */
export function parseImageRequirement(text: string): ParsedRequirement {
  const spec: Partial<DimensionSpec> = {};
  const matched: string[] = [];

  if (!text || typeof text !== "string") {
    return { matched, spec };
  }

  let working = ` ${text.toLowerCase()} `;

  // Match `re` once, record it, and blank the match so later rules can't re-hit it.
  const take = (re: RegExp): RegExpMatchArray | null => {
    const found = working.match(re);
    if (found) {
      working = working.replace(re, " ");
      matched.push(found[0].replace(/\s+/g, " ").trim());
    }
    return found;
  };

  // ── 1. File-size bound ("under 50 kb", "≤ 2 MB") ─────────────────────────
  const megabytes = take(/(\d+(?:\.\d+)?)\s*(?:mb|megabytes?)\b/);
  if (megabytes) {
    spec.targetSizeKb = Math.round(Number(megabytes[1]) * 1024);
  } else {
    const kilobytes = take(/(\d+(?:\.\d+)?)\s*(?:kb|kilobytes?)\b/);
    if (kilobytes) {
      spec.targetSizeKb = Math.round(Number(kilobytes[1]));
    }
  }

  // ── 2. Physical width×height with a unit ("35x45mm", '2 x 2 in') ──────────
  const physical = take(
    /(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch(?:es)?|in(?![\w-])|")/
  );
  if (physical) {
    spec.width = Number(physical[1]);
    spec.height = Number(physical[2]);
    spec.unit = normalizeUnit(physical[3]);
  }

  // ── 3. Pixel width×height ("800x600", "1200 x 1800 px") ──────────────────
  if (spec.width === undefined) {
    const pixels = take(
      /(\d{2,5})\s*(?:x|×|\*|by)\s*(\d{2,5})\s*(?:px|pixels?)?/
    );
    if (pixels) {
      spec.width = Number(pixels[1]);
      spec.height = Number(pixels[2]);
      spec.unit = "px";
    }
  }

  // ── 4. DPI ("300 dpi") ────────────────────────────────────────────────────
  const dpi = take(/(\d{2,4})\s*dpi\b/);
  if (dpi) {
    spec.dpi = snapDpi(Number(dpi[1]));
  }

  // ── 5. Aspect ratio ("16:9") and the "square" shorthand ──────────────────
  const ratio = take(/(\d{1,4})\s*:\s*(\d{1,4})(?![\d:])/);
  if (ratio) {
    spec.aspectRatio = `${ratio[1]}:${ratio[2]}`;
  } else if (/\bsquare\b/.test(working)) {
    take(/\bsquare\b/);
    spec.aspectRatio = "1:1";
  }

  // ── 6. Relative scale ("50%", "double", "2x") ────────────────────────────
  const percent = take(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) {
    spec.scalePercent = Number(percent[1]);
  } else if (take(/\bdouble\b|\btwice\b|\b2x\b/)) {
    spec.scalePercent = 200;
  } else if (take(/\bhalf\b/)) {
    spec.scalePercent = 50;
  } else if (take(/\btriple\b|\b3x\b/)) {
    spec.scalePercent = 300;
  }

  // ── 7. Bounds ("max 2000px", "at least 800px") ──────────────────────────
  const maxEdge = take(
    /(?:max(?:imum)?|no\s+(?:more|larger|bigger)\s+than|at\s+most|up\s+to)\s*(\d{2,5})\s*(?:px|pixels?)?/
  );
  if (maxEdge) {
    spec.maxLongEdge = Number(maxEdge[1]);
  }
  const minEdge = take(
    /(?:at\s+least|min(?:imum)?|no\s+(?:less|smaller)\s+than)\s*(\d{2,5})\s*(?:px|pixels?)?/
  );
  if (minEdge) {
    const value = Number(minEdge[1]);
    spec.minHeight = value;
    spec.minWidth = value;
  }

  // ── 8. Single edge ("1000px wide", "height 2000") ────────────────────────
  if (spec.width === undefined) {
    const wide =
      take(/(\d{2,5})\s*(?:px\s*)?wide\b/) ??
      take(/\bwidth\s*(?:of\s*)?(\d{2,5})\b/);
    if (wide) {
      spec.width = Number(wide[1]);
      spec.unit = spec.unit ?? "px";
    }
  }
  if (spec.height === undefined) {
    const tall =
      take(/(\d{2,5})\s*(?:px\s*)?(?:tall|high)\b/) ??
      take(/\bheight\s*(?:of\s*)?(\d{2,5})\b/);
    if (tall) {
      spec.height = Number(tall[1]);
      spec.unit = spec.unit ?? "px";
    }
  }

  // ── 9. Named document presets ("china visa photo", "pan card") ───────────
  for (const { key, re } of PRESET_PATTERNS) {
    if (getPresetByKey(key) && re.test(working)) {
      take(re);
      spec.preset = key;
      break;
    }
  }

  // ── 10. Fit / padding ("pad with white", "letterbox") ────────────────────
  if (/\bpad\b|\bpadd(?:ed|ing)\b|\bletter-?box\b/.test(working)) {
    take(/\bpad\b|\bpadd(?:ed|ing)\b|\bletter-?box\b/);
    spec.fit = "pad";
    if (/\bwhite\b/.test(working)) {
      take(/\bwhite\b/);
      spec.padColor = "#ffffff";
    } else if (/\bblack\b/.test(working)) {
      take(/\bblack\b/);
      spec.padColor = "#000000";
    }
  } else if (take(/\bcontain\b/)) {
    spec.fit = "contain";
  }

  return { matched, spec };
}

/** True when the parser extracted nothing usable. */
export function isEmptyRequirement(requirement: ParsedRequirement): boolean {
  return Object.keys(requirement.spec).length === 0;
}

/**
 * One-line, prompt-ready description of a parsed requirement. Returns null when
 * there is nothing worth telling the model.
 */
export function describeRequirement(
  requirement: ParsedRequirement
): string | null {
  const s = requirement.spec;
  const parts: string[] = [];

  if (s.preset) {
    parts.push(`preset=${s.preset}`);
  }
  if (s.width !== undefined) {
    parts.push(`width=${s.width}`);
  }
  if (s.height !== undefined) {
    parts.push(`height=${s.height}`);
  }
  if (s.unit) {
    parts.push(`unit=${s.unit}`);
  }
  if (s.dpi) {
    parts.push(`dpi=${s.dpi}`);
  }
  if (s.aspectRatio) {
    parts.push(`aspectRatio=${s.aspectRatio}`);
  }
  if (s.scalePercent) {
    parts.push(`scalePercent=${s.scalePercent}`);
  }
  if (s.maxLongEdge) {
    parts.push(`maxLongEdge=${s.maxLongEdge}`);
  }
  if (s.minWidth) {
    parts.push(`minWidth=${s.minWidth}`);
  }
  if (s.maxWidth) {
    parts.push(`maxWidth=${s.maxWidth}`);
  }
  if (s.maxHeight) {
    parts.push(`maxHeight=${s.maxHeight}`);
  }
  if (s.minHeight) {
    parts.push(`minHeight=${s.minHeight}`);
  }
  if (s.targetSizeKb) {
    parts.push(`targetSizeKb=${s.targetSizeKb}`);
  }
  if (s.fit) {
    parts.push(`fit=${s.fit}`);
  }
  if (s.padColor) {
    parts.push(`padColor=${s.padColor}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `Deterministic reading of the user's latest request — prefer these exact values: ${parts.join(", ")}.`;
}

function stripUndefined(spec: Partial<DimensionSpec>): Partial<DimensionSpec> {
  const out: Partial<DimensionSpec> = {};
  for (const key of Object.keys(spec) as (keyof DimensionSpec)[]) {
    const value = spec[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Merge a parsed requirement under the model's explicit arguments: explicit
 * values always win, the requirement only fills gaps. One targeted repair is
 * applied — when the model supplied the same width/height as the requirement but
 * let `unit` default to "px" for a physical request, the physical unit (and its
 * DPI) is restored.
 */
export function applyResizeRequirement(
  explicit: Partial<DimensionSpec>,
  requirement: Partial<DimensionSpec> | undefined
): Partial<DimensionSpec> {
  if (!requirement) {
    return explicit;
  }

  const merged: Partial<DimensionSpec> = {
    ...requirement,
    ...stripUndefined(explicit),
  };

  const sameNumbers =
    requirement.width !== undefined &&
    requirement.height !== undefined &&
    merged.width === requirement.width &&
    merged.height === requirement.height;

  if (
    sameNumbers &&
    requirement.unit &&
    requirement.unit !== "px" &&
    (merged.unit === undefined || merged.unit === "px") &&
    merged.preset === undefined
  ) {
    merged.unit = requirement.unit;
    if (requirement.dpi) {
      merged.dpi = requirement.dpi;
    }
  }

  return merged;
}
