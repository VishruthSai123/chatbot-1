/**
 * How a spreadsheet version is addressed.
 *
 * Mirrors the image and PDF envelopes: the bytes live in Supabase Storage and
 * `Document.content` holds a small descriptor. A 50,000-row CSV is ~4 MB of
 * text; inlining it in Postgres would duplicate the whole file for every version
 * and blow past the request-body ceiling on the first edit.
 */
export type SheetFormat = "csv" | "tsv" | "xlsx" | "json";

export type SheetRef = {
  /** Storage key of the working file. */
  storageKey: string;
  filename?: string;
  format?: SheetFormat;
  /** Sheet names inside a workbook; a delimited file has exactly one. */
  sheetNames?: string[];
  /** Which sheet the studio shows. */
  activeSheet?: string;
  /** Row count of the active sheet, excluding the header row. */
  rows?: number;
  /** Column count of the active sheet. */
  columns?: number;
  sizeBytes?: number;
};

const SHEET_REF_MARKER = "sheet-ref:";

export function encodeSheetRef(ref: SheetRef): string {
  return `${SHEET_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeSheetRef(
  content: string | null | undefined
): SheetRef | null {
  if (!content?.startsWith(SHEET_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(SHEET_REF_MARKER.length)
    ) as SheetRef;

    if (!parsed?.storageKey || typeof parsed.storageKey !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isSheetRef(content: string | null | undefined): boolean {
  return decodeSheetRef(content) !== null;
}

/** The wire shape the studio receives for one sheet. */
export type SheetPreview = {
  headers: string[];
  columns: {
    name: string;
    numericRatio: number;
    type: "number" | "string" | "boolean" | "date" | "empty";
  }[];
  /** First rows of the active sheet. */
  rows: (string | number | boolean | null)[][];
  totalRows: number;
  totalColumns: number;
  sheetNames: string[];
  activeSheet: string;
  format: SheetFormat;
};
