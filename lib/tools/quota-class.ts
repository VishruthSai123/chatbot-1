export type ToolQuotaClass = "storage" | "light" | "heavy";

/**
 * Not every tool action costs the same.
 *
 * - `storage` only writes bytes the browser already produced. It must never be
 *   charged as a hosted file operation, or enabling the quota would break the
 *   free on-device image/PDF editors.
 * - `light` is a server fallback or a cheap page operation.
 * - `heavy` is background removal, OCR, upscaling or image-to-PDF, which the
 *   free plan does not include.
 */
const STORAGE_ACTIONS = new Map<string, Set<string>>([
  ["image", new Set(["persist", "resolve", "getmetadata", "metadata"])],
  ["pdf", new Set(["persistsplit", "resolve", "getmetadata", "metadata"])],
]);

const HEAVY_ACTIONS = new Map<string, Set<string>>([
  [
    "image",
    new Set([
      "backgroundremoval",
      "ocr",
      "removebg",
      "upscale",
      "upscaleenhance",
    ]),
  ],
  ["pdf", new Set(["imagestopdf", "imagetopdf"])],
]);

function normalizeAction(action: unknown): string {
  return String(action ?? "")
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
}

export function classifyToolAction(
  family: string,
  action: unknown
): ToolQuotaClass {
  const normalizedFamily = family.toLowerCase();
  const normalizedAction = normalizeAction(action);

  if (STORAGE_ACTIONS.get(normalizedFamily)?.has(normalizedAction)) {
    return "storage";
  }

  if (HEAVY_ACTIONS.get(normalizedFamily)?.has(normalizedAction)) {
    return "heavy";
  }

  return "light";
}
