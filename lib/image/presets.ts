/**
 * Physical Dimension Presets for Official Document & Visa Photos
 *
 * Each preset defines the standard physical dimensions, DPI, and requirements
 * for common government and professional photo specifications.
 */

export type PhysicalUnit = "px" | "cm" | "mm" | "in";

export type DpiOption = 72 | 150 | 300 | 600;

export interface PhotoPreset {
  /** Target aspect ratio string (e.g. "7:9") */
  aspectRatio: string;
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
    aspectRatio: "7:9",
    displayName: "Indian Passport / OCI",
    dpi: 300,
    height: 45,
    key: "indian_passport",
    requirements:
      "Plain light/white background, 70-80% face coverage, no shadows",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aspectRatio: "1:1",
    displayName: "US Visa / US Passport",
    dpi: 300,
    height: 2,
    key: "us_visa",
    requirements:
      "Plain white background, head height between 1 in and 1⅜ in from chin to crown",
    resultPxHeight: 600,
    resultPxWidth: 600,
    unit: "in",
    width: 2,
  },
  {
    aspectRatio: "7:9",
    displayName: "Schengen Visa",
    dpi: 300,
    height: 45,
    key: "schengen_visa",
    requirements:
      "Light grey/white background, neutral expression, recent photo",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aspectRatio: "7:9",
    displayName: "UK / Australian Visa",
    dpi: 300,
    height: 45,
    key: "uk_visa",
    requirements: "Cream/light grey background, clear face border",
    resultPxHeight: 531,
    resultPxWidth: 413,
    unit: "mm",
    width: 35,
  },
  {
    aspectRatio: "4:5",
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
    aspectRatio: "5:7",
    displayName: "Indian PAN Card",
    dpi: 300,
    height: 35,
    key: "pan_card",
    maxFileSizeKb: 50,
    requirements: "White background, strict file size ≤ 50 KB",
    resultPxHeight: 413,
    resultPxWidth: 295,
    unit: "mm",
    width: 25,
  },
  {
    aspectRatio: "2:3",
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
