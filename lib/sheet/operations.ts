/**
 * Pure tabular operations for the Data Studio.
 *
 * Deliberately free of `server-only`, of `exceljs` and of any I/O: these rules
 * decide what the user sees in the grid, so they must be identical whether they
 * run in a serverless function, in the unit suite, or in the browser. The unit
 * tests import this module directly.
 */

export type CellValue = string | number | boolean | null;

/** A row keyed by column name. */
export type SheetRow = Record<string, CellValue>;

export type ColumnType = "number" | "string" | "boolean" | "date" | "empty";

export type ColumnMeta = {
  name: string;
  type: ColumnType;
  /** Fraction of populated cells that look numeric, 0–1. */
  numericRatio: number;
};

export type FilterOperator =
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "empty"
  | "not_empty";

export type SortOrder = "asc" | "desc";

export type ColumnStats = {
  name: string;
  type: ColumnType;
  /** Populated cell count. */
  count: number;
  /** Cells that were blank or null. */
  nullCount: number;
  uniqueCount: number;
  mean?: number;
  median?: number;
  min?: CellValue;
  max?: CellValue;
};

/** A column counts as numeric when at least this share of it parses as a number. */
const NUMERIC_THRESHOLD = 0.8;

/**
 * Markers spreadsheets use to mean "no value".
 *
 * A revenue column with one `n/a` is still a revenue column, but a strict parser
 * would demote it to text and then refuse to compute a mean, a median or a
 * numeric sort — which is exactly the column a user most wants to analyse. These
 * markers are therefore treated as missing values rather than as text.
 */
const NULL_LIKE = new Set([
  "#div/0!",
  "#n/a",
  "#null!",
  "#value!",
  "-",
  "--",
  "—",
  "n.a.",
  "n/a",
  "na",
  "nil",
  "none",
  "null",
  "unknown",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

function isBlank(value: CellValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** True for blanks and for the "no value" markers listed above. */
export function isNullLike(value: CellValue | undefined): boolean {
  if (isBlank(value)) {
    return true;
  }

  return typeof value === "string" && NULL_LIKE.has(value.trim().toLowerCase());
}

/**
 * Parses a cell as a number.
 *
 * Handles the shapes spreadsheets actually contain: a currency prefix, a percent
 * suffix, and thousands separators. The separator rule is deliberately strict —
 * `1,234` is one thousand two hundred and thirty-four, but `1,5` is left alone
 * rather than guessed at, because reading a European decimal as a thousands
 * separator would silently inflate a figure by a factor of a thousand.
 */
function toNumber(value: CellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim();

  if (text === "") {
    return null;
  }

  // Currency prefix.
  text = text.replace(/^([-+]?)\s*[$€£¥]\s*/, "$1");

  // Percent suffix.
  const isPercent = text.endsWith("%");
  if (isPercent) {
    text = text.slice(0, -1).trim();
  }

  // Thousands separators: groups of exactly three digits.
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  } else {
    text = text.replace(/\s/g, "");
  }

  const parsed = Number(text);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isPercent ? parsed / 100 : parsed;
}

function toDate(value: CellValue): number | null {
  if (typeof value !== "string" || !ISO_DATE.test(value.trim())) {
    return null;
  }

  const parsed = Date.parse(value.trim());

  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: CellValue): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalised = value.trim().toLowerCase();

  if (["true", "yes", "y", "1"].includes(normalised)) {
    return true;
  }

  if (["false", "no", "n", "0"].includes(normalised)) {
    return false;
  }

  return null;
}

/**
 * Infers a column's type from its populated cells.
 *
 * The numeric threshold is 80% rather than 100% on purpose: a "Revenue" column
 * with a stray "n/a" is still a numeric column, and the user should not have to
 * clean one cell to get numeric sorting and averages.
 */
export function inferColumnType(values: CellValue[]): {
  type: ColumnType;
  numericRatio: number;
} {
  const populated = values.filter((value) => !isNullLike(value));

  if (populated.length === 0) {
    return { numericRatio: 0, type: "empty" };
  }

  const numericCount = populated.filter(
    (value) => toNumber(value) !== null
  ).length;
  const numericRatio = numericCount / populated.length;

  if (numericRatio >= NUMERIC_THRESHOLD) {
    return { numericRatio, type: "number" };
  }

  const booleanCount = populated.filter(
    (value) => toBoolean(value) !== null
  ).length;

  if (booleanCount / populated.length >= NUMERIC_THRESHOLD) {
    return { numericRatio, type: "boolean" };
  }

  const dateCount = populated.filter((value) => toDate(value) !== null).length;

  if (dateCount / populated.length >= NUMERIC_THRESHOLD) {
    return { numericRatio, type: "date" };
  }

  return { numericRatio, type: "string" };
}

/** Describes every column of a row set. */
export function inferColumns(
  rows: SheetRow[],
  headers: string[]
): ColumnMeta[] {
  return headers.map((name) => {
    const values = rows.map((row) => row[name] ?? null);
    const { numericRatio, type } = inferColumnType(values);

    return { name, numericRatio, type };
  });
}

/**
 * Filters rows by a predicate on one column.
 *
 * Numeric comparison is used whenever *both* sides parse as numbers, so
 * "Revenue > 1000" compares 14250 > 1000 rather than lexicographically. Text
 * comparison is case-insensitive for the substring operators.
 */
export function filterRows(
  rows: SheetRow[],
  {
    column,
    operator,
    value,
  }: {
    column: string;
    operator: FilterOperator;
    value?: CellValue;
  }
): SheetRow[] {
  if (!(column in (rows[0] ?? {})) && rows.length > 0) {
    return rows;
  }

  return rows.filter((row) => {
    const cell = row[column] ?? null;

    switch (operator) {
      case "empty":
        return isNullLike(cell);
      case "not_empty":
        return !isNullLike(cell);
      case "contains":
        return String(cell ?? "")
          .toLowerCase()
          .includes(String(value ?? "").toLowerCase());
      case "not_contains":
        return !String(cell ?? "")
          .toLowerCase()
          .includes(String(value ?? "").toLowerCase());
      case "starts_with":
        return String(cell ?? "")
          .toLowerCase()
          .startsWith(String(value ?? "").toLowerCase());
      case "ends_with":
        return String(cell ?? "")
          .toLowerCase()
          .endsWith(String(value ?? "").toLowerCase());
      default:
        break;
    }

    if (isNullLike(cell)) {
      // A blank cell never satisfies an ordering comparison, but it *does* satisfy
      // "!=" so that "remove the empty ones" is expressible.
      return operator === "!=";
    }

    const left = toNumber(cell);
    const right = toNumber(value ?? null);

    if (left !== null && right !== null) {
      switch (operator) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case ">":
          return left > right;
        case "<":
          return left < right;
        case ">=":
          return left >= right;
        case "<=":
          return left <= right;
        default:
          return true;
      }
    }

    const leftText = String(cell);
    const rightText = String(value ?? "");

    switch (operator) {
      case "==":
        return leftText === rightText;
      case "!=":
        return leftText !== rightText;
      case ">":
        return leftText > rightText;
      case "<":
        return leftText < rightText;
      case ">=":
        return leftText >= rightText;
      case "<=":
        return leftText <= rightText;
      default:
        return true;
    }
  });
}

/**
 * Sorts rows by a column.
 *
 * Numbers sort numerically, dates chronologically and everything else by locale
 * comparison. Blank cells always sort last regardless of direction — an empty
 * cell is "unknown", not "smallest", and putting it at the top of a descending
 * sort is never what anyone wants.
 */
export function sortRows(
  rows: SheetRow[],
  column: string,
  order: SortOrder = "asc"
): SheetRow[] {
  const direction = order === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = a[column] ?? null;
    const right = b[column] ?? null;

    const leftBlank = isNullLike(left);
    const rightBlank = isNullLike(right);

    if (leftBlank || rightBlank) {
      if (leftBlank && rightBlank) {
        return 0;
      }
      return leftBlank ? 1 : -1;
    }

    const leftNumber = toNumber(left);
    const rightNumber = toNumber(right);

    if (leftNumber !== null && rightNumber !== null) {
      return (leftNumber - rightNumber) * direction;
    }

    const leftDate = toDate(left);
    const rightDate = toDate(right);

    if (leftDate !== null && rightDate !== null) {
      return (leftDate - rightDate) * direction;
    }

    return (
      String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction
    );
  });
}

/**
 * Removes duplicate rows.
 *
 * With no key columns the whole row is the key. With key columns, rows that
 * share the same values *in those columns* are duplicates, and the first
 * occurrence is kept — the same rule `UNIQUE` follows in SQL.
 */
export function removeDuplicateRows(
  rows: SheetRow[],
  keyColumns?: string[]
): { removed: number; rows: SheetRow[] } {
  const keys = keyColumns?.filter(Boolean) ?? [];
  const seen = new Set<string>();
  const kept: SheetRow[] = [];

  for (const row of rows) {
    const key = keys.length
      ? keys.map((column) => String(row[column] ?? "")).join("\u0000")
      : Object.keys(row)
          .sort()
          .map((column) => `${column}\u0001${String(row[column] ?? "")}`)
          .join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push(row);
  }

  return { removed: rows.length - kept.length, rows: kept };
}

/** Computes per-column summary statistics. */
export function computeSummaryStats(
  rows: SheetRow[],
  headers: string[]
): ColumnStats[] {
  return headers.map((name) => {
    const values = rows.map((row) => row[name] ?? null);
    const populated = values.filter((value) => !isNullLike(value));
    const { type } = inferColumnType(values);
    const uniqueCount = new Set(populated.map((value) => String(value))).size;

    if (type === "number" && populated.length > 0) {
      const numbers = populated
        .map((value) => toNumber(value))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const sum = numbers.reduce((total, value) => total + value, 0);
      const middle = Math.floor(numbers.length / 2);
      const median =
        numbers.length % 2 === 0
          ? (numbers[middle - 1] + numbers[middle]) / 2
          : numbers[middle];

      return {
        count: populated.length,
        max: numbers.at(-1),
        mean: Number((sum / numbers.length).toFixed(2)),
        median: Number(median.toFixed(2)),
        min: numbers[0],
        name,
        nullCount: rows.length - populated.length,
        type,
        uniqueCount,
      };
    }

    if (type === "date" && populated.length > 0) {
      const times = populated
        .map((value) => toDate(value))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);

      return {
        count: populated.length,
        max: new Date(times.at(-1) ?? 0).toISOString(),
        min: new Date(times[0]).toISOString(),
        name,
        nullCount: rows.length - populated.length,
        type,
        uniqueCount,
      };
    }

    return {
      count: populated.length,
      name,
      nullCount: rows.length - populated.length,
      type,
      uniqueCount,
    };
  });
}

/** Turns rows into a dense matrix ordered by `headers`. */
export function rowsToMatrix(
  rows: SheetRow[],
  headers: string[]
): CellValue[][] {
  return rows.map((row) => headers.map((header) => row[header] ?? null));
}

/** Turns a dense matrix back into rows keyed by `headers`. */
export function matrixToRows(
  matrix: CellValue[][],
  headers: string[]
): SheetRow[] {
  return matrix.map((values) => {
    const row: SheetRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? null;
    });

    return row;
  });
}

/**
 * Coerces cells to the type their column was inferred as.
 *
 * This runs when a sheet is *written*, not when it is read. The reason is
 * Excel: a cell containing the text `9,800` is not a number to Excel, so a
 * workbook written from raw text refuses to sum its own revenue column. Coercing
 * on the way out produces a workbook that behaves like a spreadsheet.
 *
 * The leading-zero guard is the important part. `007` is a zip code, a product
 * code and a telephone prefix; turning it into `7` would silently corrupt the
 * data, so such cells are left exactly as they were found.
 */
export function coerceRows(rows: SheetRow[], headers: string[]): SheetRow[] {
  const metas = inferColumns(rows, headers);

  return rows.map((row) => {
    const coerced: SheetRow = { ...row };

    headers.forEach((header, index) => {
      const meta = metas[index];
      const value = row[header];

      if (isNullLike(value)) {
        coerced[header] = null;
        return;
      }

      if (meta.type === "number") {
        const parsed = toNumber(value);

        if (parsed !== null && !hasLeadingZero(value)) {
          coerced[header] = parsed;
        }
        return;
      }

      if (meta.type === "boolean") {
        const parsed = toBoolean(value);

        if (parsed !== null) {
          coerced[header] = parsed;
        }
      }
    });

    return coerced;
  });
}

/** True for a numeric-looking string that starts with a zero digit. */
function hasLeadingZero(value: CellValue): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  return /^-?0\d/.test(trimmed);
}

/** Turns a header cell into a usable, unique column name. */
export function normaliseHeader(value: CellValue, index: number): string {
  const text = String(value ?? "").trim();

  return text === "" ? `Column ${index + 1}` : text;
}

/**
 * Makes header names unique.
 *
 * Spreadsheets routinely repeat a header ("Date" in every month block). Without
 * this, two columns would share a key and one would silently overwrite the other
 * in every row object.
 */
export function uniqueHeaders(raw: CellValue[]): string[] {
  const seen = new Map<string, number>();

  return raw.map((value, index) => {
    const base = normaliseHeader(value, index);
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return count === 0 ? base : `${base} (${count + 1})`;
  });
}
