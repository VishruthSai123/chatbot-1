/**
 * Physical Dimension Presets for Official Document & Visa Photos
 *
 * Each preset defines the standard physical dimensions, DPI, and requirements
 * for common government and professional photo specifications.
 */

export type PhysicalUnit = "px" | "cm" | "mm" | "in";

export type DpiOption = 72 | 150 | 300 | 600;

/** Grouping used by the preset picker and the runtime lookup. */
export type PhotoPresetCategory = "id_card" | "passport_visa" | "print_digital";

export interface PhotoPreset {
  /** Extra search synonyms used by `findPresetsByQuery`. */
  aliases?: string[];
  /** Target aspect ratio string (e.g. "7:9") */
  aspectRatio: string;
  /** Picker group this preset belongs to */
  category: PhotoPresetCategory;
  /** Human-readable display name */
  displayName: string;
  /** Recommended DPI for this specification */
  dpi: DpiOption;
  /** Height in the specified unit */
  height: number;
  /** Unique key for programmatic access */
  key: string;
  /** Optional maximum file size in KB */
  maxFileSizeKb?: number;
  /** Country / region this specification applies to */
  region?: string;
  /** Human-readable requirements */
  requirements: string;
  /** Resulting pixel height at the default DPI */
  resultPxHeight: number;
  /** Resulting pixel width at the default DPI */
  resultPxWidth: number;
  /** Physical unit for the dimensions */
  unit: PhysicalUnit;
  /** Width in the specified unit */
  width: number;
}

export const PRESET_CATEGORY_LABELS: Record<PhotoPresetCategory, string> = {
  id_card: "ID & Card Photos",
  passport_visa: "Passports & Visas",
  print_digital: "Prints & Digital",
};

/**
 * Convert a physical dimension value to pixels based on unit and DPI.
 *
 * Conversion formulas:
 *   mm → px: round((mm / 25.4) × DPI)
 *   cm → px: round((cm × 10 / 25.4) × DPI)
 *   in → px: round(in × DPI)
 *   px → px: identity
 */
export function physicalToPixels(
  value: number,
  unit: PhysicalUnit,
  dpi: DpiOption
): number {
  switch (unit) {
    case "mm":
      return Math.round((value / 25.4) * dpi);
    case "cm":
      return Math.round(((value * 10) / 25.4) * dpi);
    case "in":
      return Math.round(value * dpi);
    case "px":
      return Math.round(value);
    default:
      return Math.round(value);
  }
}

/**
 * Convert pixel dimensions back to a physical unit for display.
 */
export function pixelsToPhysical(
  px: number,
  unit: PhysicalUnit,
  dpi: DpiOption
): number {
  switch (unit) {
    case "mm":
      return Number(((px / dpi) * 25.4).toFixed(1));
    case "cm":
      return Number(((px / dpi) * 2.54).toFixed(2));
    case "in":
      return Number((px / dpi).toFixed(2));
    case "px":
      return px;
    default:
      return px;
  }
}

/**
 * Official Document & Visa Photo Presets
 */
export const PHOTO_PRESETS: PhotoPreset[] = [
  {
    aliases: ["india passport", "indian oci", "oci", "indian visa photo"],
    aspectRatio: "7:9",
    category: "passport_visa",
    displayName: "Indian Passport / OCI",
    dpi: 300,
    height: 45,
    key: "indian_passport",
    region: "India",
    requirements:
      "Plain light/white background, 70-80% face coverage, no shadows",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aliases: ["universal passport photo", "passport sized photo"],
    aspectRatio: "7:9",
    category: "passport_visa",
    displayName: "Universal Passport Photo",
    dpi: 300,
    height: 45,
    key: "passport_photo",
    requirements: "Generic 35×45 mm passport/ID photo — plain light background",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aliases: [
      "us passport",
      "american visa",
      "2x2 inch photo",
      "us visa photo",
    ],
    aspectRatio: "1:1",
    category: "passport_visa",
    displayName: "US Visa / US Passport",
    dpi: 300,
    height: 2,
    key: "us_visa",
    region: "United States",
    requirements:
      "Plain white background, head height between 1 in and 1⅜ in from chin to crown",
    resultPxHeight: 600,
    resultPxWidth: 600,
    unit: "in",
    width: 2,
  },
  {
    aliases: ["green card", "uscis", "permanent resident"],
    aspectRatio: "1:1",
    category: "passport_visa",
    displayName: "US Green Card / Citizenship",
    dpi: 300,
    height: 2,
    key: "us_green_card",
    region: "United States",
    requirements: "Plain white background, 2×2 in, neutral expression",
    resultPxHeight: 600,
    resultPxWidth: 600,
    unit: "in",
    width: 2,
  },
  {
    aliases: [
      "europe visa",
      "eu visa",
      "germany visa",
      "france visa",
      "italy visa",
      "spain visa",
    ],
    aspectRatio: "7:9",
    category: "passport_visa",
    displayName: "Schengen Visa (EU)",
    dpi: 300,
    height: 45,
    key: "schengen_visa",
    region: "Europe",
    requirements:
      "Light grey/white background, neutral expression, recent photo",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aliases: [
      "british visa",
      "uk passport",
      "australia visa",
      "australian visa",
      "new zealand visa",
    ],
    aspectRatio: "7:9",
    category: "passport_visa",
    displayName: "UK / Australian Visa",
    dpi: 300,
    height: 45,
    key: "uk_visa",
    region: "United Kingdom",
    requirements: "Cream/light grey background, clear face border",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aliases: ["chinese visa", "china passport photo"],
    aspectRatio: "11:16",
    category: "passport_visa",
    displayName: "China Visa",
    dpi: 300,
    height: 48,
    key: "china_visa",
    region: "China",
    requirements: "White background, 33×48 mm, head 28-33 mm tall",
    resultPxHeight: 567,
    resultPxWidth: 390,
    unit: "mm",
    width: 33,
  },
  {
    aliases: ["japanese visa"],
    aspectRatio: "1:1",
    category: "passport_visa",
    displayName: "Japan Visa",
    dpi: 300,
    height: 45,
    key: "japan_visa",
    region: "Japan",
    requirements: "White background, 45×45 mm square",
    resultPxHeight: 531,
    resultPxWidth: 531,
    unit: "mm",
    width: 45,
  },
  {
    aliases: ["canadian visa"],
    aspectRatio: "5:7",
    category: "passport_visa",
    displayName: "Canada Visa",
    dpi: 300,
    height: 70,
    key: "canada_visa",
    region: "Canada",
    requirements: "White background, 50×70 mm, face 31-36 mm",
    resultPxHeight: 827,
    resultPxWidth: 591,
    unit: "mm",
    width: 50,
  },
  {
    aliases: ["emirates visa", "dubai visa"],
    aspectRatio: "43:55",
    category: "passport_visa",
    displayName: "UAE Visa",
    dpi: 300,
    height: 55,
    key: "uae_visa",
    region: "United Arab Emirates",
    requirements: "White background, 43×55 mm",
    resultPxHeight: 650,
    resultPxWidth: 508,
    unit: "mm",
    width: 43,
  },
  {
    aliases: ["indian e visa", "india tourist visa", "indian evisa"],
    aspectRatio: "1:1",
    category: "passport_visa",
    displayName: "India e-Visa",
    dpi: 300,
    height: 2,
    key: "india_evisa",
    region: "India",
    requirements: "Square 2×2 in, plain light background, min 350×350 px",
    resultPxHeight: 600,
    resultPxWidth: 600,
    unit: "in",
    width: 2,
  },
  {
    aliases: ["pan card photo", "income tax photo"],
    aspectRatio: "5:7",
    category: "id_card",
    displayName: "Indian PAN Card",
    dpi: 300,
    height: 35,
    key: "pan_card",
    maxFileSizeKb: 50,
    region: "India",
    requirements: "White background, strict file size ≤ 50 KB",
    resultPxHeight: 413,
    resultPxWidth: 295,
    unit: "mm",
    width: 25,
  },
  {
    aliases: ["stamp photo", "certificate photo"],
    aspectRatio: "4:5",
    category: "id_card",
    displayName: "Stamp Size",
    dpi: 300,
    height: 25,
    key: "stamp_size",
    requirements: "Compact ID/certificate photos",
    resultPxHeight: 295,
    resultPxWidth: 236,
    unit: "mm",
    width: 20,
  },
  {
    aliases: ["1 inch photo", "one inch photo"],
    aspectRatio: "1:1",
    category: "id_card",
    displayName: "1×1 Inch ID Photo",
    dpi: 300,
    height: 1,
    key: "id_photo_1inch",
    requirements: "Generic 1×1 in ID photo",
    resultPxHeight: 300,
    resultPxWidth: 300,
    unit: "in",
    width: 1,
  },
  {
    aliases: ["35x35 photo", "square id photo"],
    aspectRatio: "1:1",
    category: "id_card",
    displayName: "35×35 mm ID Photo",
    dpi: 300,
    height: 35,
    key: "id_photo_35x35",
    requirements: "Square 35×35 mm ID photo",
    resultPxHeight: 413,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aliases: ["4x6 print", "photo print", "postcard", "lab print"],
    aspectRatio: "2:3",
    category: "print_digital",
    displayName: "Standard Photo Print (4×6)",
    dpi: 300,
    height: 6,
    key: "photo_4x6",
    requirements: "High-resolution lab print",
    resultPxHeight: 1800,
    resultPxWidth: 1200,
    unit: "in",
    width: 4,
  },
];

/**
 * Crop aspect ratio presets for the interactive canvas crop overlay.
 */
export interface CropAspectPreset {
  displayName: string;
  key: string;
  /** null means freeform (no lock) */
  ratio: number | null;
}

export const CROP_ASPECT_PRESETS: CropAspectPreset[] = [
  { displayName: "Freeform", key: "free", ratio: null },
  { displayName: "1:1 Square", key: "1:1", ratio: 1 },
  { displayName: "4:5 Portrait", key: "4:5", ratio: 4 / 5 },
  { displayName: "5:7 PAN Card", key: "5:7", ratio: 5 / 7 },
  { displayName: "7:9 Passport", key: "7:9", ratio: 7 / 9 },
  { displayName: "16:9 Landscape", key: "16:9", ratio: 16 / 9 },
  { displayName: "2:3 Photo Print", key: "2:3", ratio: 2 / 3 },
];

/**
 * Available DPI options for the DPI selector in the UI.
 */
export const DPI_OPTIONS: { value: DpiOption; label: string }[] = [
  { label: "72 DPI – Screen", value: 72 },
  { label: "150 DPI – Office/Web", value: 150 },
  { label: "300 DPI – Print (Default)", value: 300 },
  { label: "600 DPI – Archival", value: 600 },
];

/**
 * Available physical unit options for the unit toggle.
 */
export const UNIT_OPTIONS: { value: PhysicalUnit; label: string }[] = [
  { label: "px", value: "px" },
  { label: "cm", value: "cm" },
  { label: "mm", value: "mm" },
  { label: "in", value: "in" },
];

/**
 * Look up a preset by its key.
 */
export function getPresetByKey(key: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.key === key);
}

const CATEGORY_ORDER: PhotoPresetCategory[] = [
  "passport_visa",
  "id_card",
  "print_digital",
];

/**
 * Group presets by category, ready for rendering as `<optgroup>`s.
 */
export function groupPresetsByCategory(
  presets: PhotoPreset[] = PHOTO_PRESETS
): { category: PhotoPresetCategory; label: string; presets: PhotoPreset[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: PRESET_CATEGORY_LABELS[category],
    presets: presets.filter((preset) => preset.category === category),
  })).filter((group) => group.presets.length > 0);
}

/**
 * Fuzzy, deterministic preset lookup used by both the AI `imageListPresets`
 * tool and the resizer's preset search box. Matches on key, display name,
 * category, region and aliases; returns the best matches first.
 */
export function findPresetsByQuery(query: string, limit = 5): PhotoPreset[] {
  const normalized = (query ?? "").trim().toLowerCase();
  if (!normalized) {
    return PHOTO_PRESETS.slice(0, limit);
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

  const scored = PHOTO_PRESETS.map((preset) => {
    const haystack = [
      preset.key.replace(/[_-]+/g, " "),
      preset.displayName,
      preset.region ?? "",
      PRESET_CATEGORY_LABELS[preset.category],
      ...(preset.aliases ?? []),
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += token.length >= 4 ? 3 : 2;
      }
    }
    if (haystack.includes(normalized)) {
      score += 4;
    }
    if (
      preset.key === normalized ||
      preset.displayName.toLowerCase() === normalized
    ) {
      score += 6;
    }
    return { preset, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.preset.displayName.localeCompare(b.preset.displayName)
    )
    .slice(0, limit)
    .map((entry) => entry.preset);
}
