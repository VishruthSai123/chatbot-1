/**
 * Physical Dimension Presets for Official Document & Visa Photos
 *
 * Each preset defines the standard physical dimensions, DPI, and requirements
 * for common government and professional photo specifications.
 */

export type PhysicalUnit = "px" | "cm" | "mm" | "in";

export type DpiOption = 72 | 150 | 300 | 600;

export interface PhotoPreset {
  /** Unique key for programmatic access */
  key: string;
  /** Human-readable display name */
  displayName: string;
  /** Width in the specified unit */
  width: number;
  /** Height in the specified unit */
  height: number;
  /** Physical unit for the dimensions */
  unit: PhysicalUnit;
  /** Recommended DPI for this specification */
  dpi: DpiOption;
  /** Resulting pixel width at the default DPI */
  resultPxWidth: number;
  /** Resulting pixel height at the default DPI */
  resultPxHeight: number;
  /** Target aspect ratio string (e.g. "7:9") */
  aspectRatio: string;
  /** Human-readable requirements */
  requirements: string;
  /** Optional maximum file size in KB */
  maxFileSizeKb?: number;
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
    key: "indian_passport",
    displayName: "Indian Passport / OCI",
    width: 35,
    height: 45,
    unit: "mm",
    dpi: 300,
    resultPxWidth: 413,
    resultPxHeight: 531,
    aspectRatio: "7:9",
    requirements:
      "Plain light/white background, 70-80% face coverage, no shadows",
  },
  {
    key: "us_visa",
    displayName: "US Visa / US Passport",
    width: 2,
    height: 2,
    unit: "in",
    dpi: 300,
    resultPxWidth: 600,
    resultPxHeight: 600,
    aspectRatio: "1:1",
    requirements:
      'Plain white background, head height between 1 in and 1⅜ in from chin to crown',
  },
  {
    key: "schengen_visa",
    displayName: "Schengen Visa",
    width: 35,
    height: 45,
    unit: "mm",
    dpi: 300,
    resultPxWidth: 413,
    resultPxHeight: 531,
    aspectRatio: "7:9",
    requirements: "Light grey/white background, neutral expression, recent photo",
  },
  {
    key: "uk_visa",
    displayName: "UK / Australian Visa",
    width: 35,
    height: 45,
    unit: "mm",
    dpi: 300,
    resultPxWidth: 413,
    resultPxHeight: 531,
    aspectRatio: "7:9",
    requirements: "Cream/light grey background, clear face border",
  },
  {
    key: "stamp_size",
    displayName: "Stamp Size",
    width: 20,
    height: 25,
    unit: "mm",
    dpi: 300,
    resultPxWidth: 236,
    resultPxHeight: 295,
    aspectRatio: "4:5",
    requirements: "Compact ID/certificate photos",
  },
  {
    key: "pan_card",
    displayName: "Indian PAN Card",
    width: 25,
    height: 35,
    unit: "mm",
    dpi: 300,
    resultPxWidth: 295,
    resultPxHeight: 413,
    aspectRatio: "5:7",
    requirements: "White background, strict file size ≤ 50 KB",
    maxFileSizeKb: 50,
  },
  {
    key: "photo_4x6",
    displayName: "Standard Photo Print (4×6)",
    width: 4,
    height: 6,
    unit: "in",
    dpi: 300,
    resultPxWidth: 1200,
    resultPxHeight: 1800,
    aspectRatio: "2:3",
    requirements: "High-resolution lab print",
  },
];

/**
 * Crop aspect ratio presets for the interactive canvas crop overlay.
 */
export interface CropAspectPreset {
  key: string;
  displayName: string;
  /** null means freeform (no lock) */
  ratio: number | null;
}

export const CROP_ASPECT_PRESETS: CropAspectPreset[] = [
  { key: "free", displayName: "Freeform", ratio: null },
  { key: "1:1", displayName: "1:1 Square", ratio: 1 },
  { key: "4:5", displayName: "4:5 Portrait", ratio: 4 / 5 },
  { key: "5:7", displayName: "5:7 PAN Card", ratio: 5 / 7 },
  { key: "7:9", displayName: "7:9 Passport", ratio: 7 / 9 },
  { key: "16:9", displayName: "16:9 Landscape", ratio: 16 / 9 },
  { key: "2:3", displayName: "2:3 Photo Print", ratio: 2 / 3 },
];

/**
 * Available DPI options for the DPI selector in the UI.
 */
export const DPI_OPTIONS: { value: DpiOption; label: string }[] = [
  { value: 72, label: "72 DPI – Screen" },
  { value: 150, label: "150 DPI – Office/Web" },
  { value: 300, label: "300 DPI – Print (Default)" },
  { value: 600, label: "600 DPI – Archival" },
];

/**
 * Available physical unit options for the unit toggle.
 */
export const UNIT_OPTIONS: { value: PhysicalUnit; label: string }[] = [
  { value: "px", label: "px" },
  { value: "cm", label: "cm" },
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
];

/**
 * Look up a preset by its key.
 */
export function getPresetByKey(key: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((p) => p.key === key);
}
