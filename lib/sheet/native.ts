import "server-only";

import ExcelJS from "exceljs";
import { parse, unparse } from "papaparse";

import {
  type CellValue,
  coerceRows,
  inferColumns,
  matrixToRows,
  rowsToMatrix,
  type SheetRow,
  uniqueHeaders,
} from "./operations";
import type { SheetFormat } from "./ref";

/**
 * Reading and writing spreadsheet files.
 *
 * Three formats, two engines, no external service:
 *
 * - CSV / TSV: `papaparse`. Streaming, fast, and dependency-light.
 * - XLSX: `exceljs`. It is pure JavaScript, so it runs in a serverless function
 *   without a native binary. (`xlsx`/SheetJS was rejected: the npm build is
 *   frozen at 0.18.5 and carries a known prototype-pollution advisory.)
 *
 * Everything in here is I/O against a buffer — never storage, never the database —
 * so the orchestration stays in `lib/tools/sheet`.
 */

export type LoadedSheet = {
  /** Sheet name, or "Data" for a delimited file. */
  name: string;
  headers: string[];
  rows: SheetRow[];
};

/**
 * Formats that can be *read* back into a grid.
 *
 * JSON is a write target but not a read target: a JSON file is a list of objects
 * with no header row to infer, so supporting it here would mean guessing at the
 * shape. It stays a valid export format.
 */
export type ReadSheetFormat = "csv" | "tsv" | "xlsx";

export type LoadedWorkbook = {
  format: ReadSheetFormat;
  sheets: LoadedSheet[];
};

function detectFormat(buffer: Buffer, filename?: string): ReadSheetFormat {
  // XLSX is a ZIP: "PK\x03\x04". Checking the magic bytes is more reliable than
  // trusting the extension, which a user can get wrong.
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return "xlsx";
  }

  const lower = (filename ?? "").toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return "xlsx";
  }

  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    return "tsv";
  }

  return "csv";
}

/** Reads a delimited file into a single sheet. */
function loadDelimited(buffer: Buffer, format: "csv" | "tsv"): LoadedSheet {
  const text = buffer.toString("utf8");
  const parsed = parse<string[]>(text, {
    delimiter: format === "tsv" ? "\t" : ",",
    skipEmptyLines: "greedy",
  });

  const rawHeaders = parsed.data[0] ?? [];
  const headers = uniqueHeaders(rawHeaders);
  const body = rawHeaders.length > 0 ? parsed.data.slice(1) : parsed.data;

  const rows = body.map((values) => {
    const row: SheetRow = {};

    headers.forEach((header, index) => {
      // An absent cell is null; a cell that is present but empty stays an empty
      // string. The distinction matters when a row is ragged: "1,2" in a
      // three-column sheet has no third value, rather than an empty one.
      row[header] = values[index] ?? null;
    });

    return row;
  });

  return { headers, name: "Data", rows };
}

/** Reads an XLSX workbook, preserving every sheet. */
async function loadWorkbook(buffer: Buffer): Promise<LoadedSheet[]> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: LoadedSheet[] = [];

  for (const worksheet of workbook.worksheets) {
    const rawHeaders: CellValue[] = [];
    const body: CellValue[][] = [];

    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const values = worksheet.getRow(rowNumber).values as unknown[];

      // `row.values` is 1-based: index 0 is a placeholder.
      const cells = values.slice(1).map((value) => {
        if (value === null || value === undefined) {
          return null;
        }

        if (value instanceof Date) {
          return value.toISOString();
        }

        // A cell may hold a rich object (formula result, hyperlink, shared
        // formula). Take its displayed value rather than the raw object.
        if (typeof value === "object") {
          const rich = value as {
            result?: unknown;
            text?: string;
            hyperlink?: string;
          };

          if (rich.result !== undefined && rich.result !== null) {
            return String(rich.result) as CellValue;
          }

          return (rich.text ?? rich.hyperlink ?? "") as CellValue;
        }

        return value as CellValue;
      });

      if (rowNumber === 1) {
        rawHeaders.push(...cells);
      } else {
        body.push(cells);
      }
    }

    const headers = uniqueHeaders(rawHeaders);
    const rows = body.map((values) => {
      const row: SheetRow = {};

      headers.forEach((header, index) => {
        row[header] = values[index] ?? null;
      });

      return row;
    });

    sheets.push({ headers, name: worksheet.name || "Data", rows });
  }

  return sheets;
}

/** Reads any supported file into a workbook description. */
export async function readSheetFile(
  buffer: Buffer,
  filename?: string
): Promise<LoadedWorkbook> {
  const format = detectFormat(buffer, filename);

  if (format === "xlsx") {
    const sheets = await loadWorkbook(buffer);

    if (sheets.length === 0) {
      throw new Error("That workbook has no sheets.");
    }

    return { format, sheets };
  }

  return { format, sheets: [loadDelimited(buffer, format)] };
}

/** Serialises sheets to a delimited file. */
export function writeDelimited(
  sheets: LoadedSheet[],
  format: "csv" | "tsv"
): Buffer {
  const chunks: string[] = [];

  for (const sheet of sheets) {
    const matrix = rowsToMatrix(
      coerceRows(sheet.rows, sheet.headers),
      sheet.headers
    );

    // The header row is prepended to the data rather than passed through
    // papaparse's `header` option, which only controls whether object keys are
    // emitted — it cannot name the columns.
    chunks.push(
      unparse([sheet.headers, ...matrix], {
        delimiter: format === "tsv" ? "\t" : ",",
      })
    );
  }

  return Buffer.from(chunks.join("\n"), "utf8");
}

/** Serialises sheets to JSON (an array of row objects per sheet). */
export function writeJson(sheets: LoadedSheet[]): Buffer {
  const payload = sheets.map((sheet) => ({
    name: sheet.name,
    rows: coerceRows(sheet.rows, sheet.headers),
  }));

  return Buffer.from(JSON.stringify(payload, null, 2), "utf8");
}

/** Serialises sheets to an XLSX workbook. */
export async function writeXlsx(sheets: LoadedSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    // Excel sheet names are capped at 31 characters and cannot contain []:*?/\
    const name = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Data";
    const worksheet = workbook.addWorksheet(name);
    const rows = coerceRows(sheet.rows, sheet.headers);

    worksheet.addRow(sheet.headers);

    for (const row of rows) {
      worksheet.addRow(sheet.headers.map((header) => row[header] ?? null));
    }

    // Header emphasis and a frozen top row make a 50,000-row sheet navigable.
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    sheet.headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      column.width = Math.min(40, Math.max(10, header.length + 2));
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer as ArrayBuffer);
}

/** Serialises sheets in the requested format. */
export async function writeSheetFile(
  sheets: LoadedSheet[],
  format: SheetFormat
): Promise<Buffer> {
  if (format === "xlsx") {
    return await writeXlsx(sheets);
  }

  if (format === "json") {
    return writeJson(sheets);
  }

  return writeDelimited(sheets, format);
}

/** Builds the studio payload for one sheet. */
export function describeSheet(sheet: LoadedSheet) {
  const columns = inferColumns(sheet.rows, sheet.headers);

  return {
    columns: columns.map((column) => ({
      name: column.name,
      numericRatio: column.numericRatio,
      type: column.type,
    })),
    headers: sheet.headers,
    totalColumns: sheet.headers.length,
    totalRows: sheet.rows.length,
  };
}

/** Extracts a window of rows for the grid. */
export function sliceRows(
  sheet: LoadedSheet,
  offset: number,
  limit: number
): (string | number | boolean | null)[][] {
  return rowsToMatrix(sheet.rows.slice(offset, offset + limit), sheet.headers);
}

/** Rehydrates a matrix into rows, used when a client submits edited cells. */
export function matrixToSheetRows(
  matrix: (string | number | boolean | null)[][],
  headers: string[]
): SheetRow[] {
  return matrixToRows(matrix, headers);
}
