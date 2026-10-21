import { z } from "zod";

/**
 * Schemas for the data family.
 *
 * One definition shared by the API route, the chat tools and the unit tests, so
 * a field cannot drift between what the model sends and what the route accepts.
 */

export const sheetFilterOperator = z.enum([
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
]);

export const sheetSortOrder = z.enum(["asc", "desc"]);

export const sheetTargetFormat = z.enum(["csv", "tsv", "xlsx", "json"]);

export const filterSortSchema = z.object({
  filterColumn: z.string().optional().describe("Column to filter on."),
  filterOperator: sheetFilterOperator
    .optional()
    .describe('Comparison to apply, e.g. ">", "contains", "==".'),
  filterValue: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe("Value to compare the column against."),
  sortColumn: z.string().optional().describe("Column to sort by."),
  sortOrder: sheetSortOrder.optional().describe("Sort direction."),
});

export const dedupeSchema = z.object({
  keyColumns: z
    .array(z.string())
    .optional()
    .describe(
      "Columns that together identify a duplicate. Omit to treat the whole row as the key."
    ),
});

export const statsSchema = z.object({
  columns: z
    .array(z.string())
    .optional()
    .describe("Columns to summarise. Omit for every column."),
});

export const convertSchema = z.object({
  targetFormat: sheetTargetFormat.describe(
    "Format to write the result in: csv, tsv, xlsx or json."
  ),
});

export const rowsSchema = z.object({
  limit: z.number().int().min(1).max(2000).optional().default(200),
  offset: z.number().int().min(0).optional().default(0),
  sheetName: z.string().optional(),
});

export const resolveSchema = z.object({
  sheetName: z
    .string()
    .optional()
    .describe("Which sheet to open. Omit for the first one."),
});

export type FilterSortInput = z.input<typeof filterSortSchema>;
export type DedupeInput = z.input<typeof dedupeSchema>;
export type StatsInput = z.input<typeof statsSchema>;
export type ConvertInput = z.input<typeof convertSchema>;
export type RowsInput = z.input<typeof rowsSchema>;
export type ResolveInput = z.input<typeof resolveSchema>;

export type SheetAction =
  | "resolve"
  | "rows"
  | "filter_sort"
  | "dedupe"
  | "stats"
  | "convert";

export type SheetOperationPayload = {
  filename: string;
  rows: number;
  columns: number;
  sheetNames: string[];
  activeSheet: string;
  format: "csv" | "tsv" | "xlsx" | "json";
  sizeBytes: number;
  storageKey: string;
  /** Signed URL for immediate preview/download. */
  url: string;
};

export type SheetOperationResponse = {
  success: true;
  documentId?: string;
  persisted: boolean;
  result?: SheetOperationPayload;
  /** Present for `stats`. */
  stats?: {
    name: string;
    type: string;
    count: number;
    nullCount: number;
    uniqueCount: number;
    mean?: number;
    median?: number;
    min?: string | number | boolean | null;
    max?: string | number | boolean | null;
  }[];
  /** Present for `filter_sort` and `dedupe`: how many rows survived. */
  affected?: { before: number; after: number; removed?: number };
};
