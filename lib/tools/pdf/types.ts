import { z } from "zod";

/**
 * Schemas for the PDF family.
 *
 * Kept in their own module for the same reason the image ones are: the API route,
 * the chat tools and the unit tests all validate against exactly one definition, so
 * a field cannot drift between what the model sends and what the route accepts.
 */

export const pdfPageRangeSchema = z
  .string()
  .min(1)
  .max(512)
  .describe(
    'Pages to act on, 1-based, as "1-3, 5, 8-" — commas for separate pages or ranges, an open end means "through the last page". Use ";" to separate output groups when splitting.'
  );

export const pdfPageListSchema = z
  .array(z.number().int().min(1))
  .min(1)
  .max(2000)
  .describe("Explicit 1-based page numbers.");

export const mergeSchema = z.object({
  filenames: z
    .array(z.string())
    .optional()
    .describe("Optional titles for the merged source documents, for logging."),
});

export const splitSchema = z.object({
  pageRanges: pdfPageRangeSchema
    .optional()
    .describe(
      'Pages to keep. "1-3" keeps those three in one file; "1-3; 4-6" produces two files. Omit to split every page into its own document.'
    ),
});

export const arrangeSchema = z.object({
  pageOrder: pdfPageListSchema
    .optional()
    .describe(
      "New 1-based page order. Pages not listed are removed. Omit to keep the current order."
    ),
  rotations: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      'Absolute rotation per page, keyed by 1-based page number, e.g. {"2": 90}. Replaces that page\'s rotation rather than adding to it.'
    ),
});

export const rotateSchema = z.object({
  degrees: z
    .number()
    .min(-360)
    .max(360)
    .describe("Degrees to rotate, clockwise. Snapped to the nearest 90."),
  pages: z
    .union([z.literal("all"), pdfPageListSchema])
    .optional()
    .default("all")
    .describe('Which pages to rotate: "all" or explicit 1-based page numbers.'),
});

export const extractTextSchema = z.object({
  pageRanges: pdfPageRangeSchema
    .optional()
    .describe("Pages to extract. Omit for the whole document."),
});

export const imagesToPdfSchema = z.object({
  documentIds: z
    .array(z.string())
    .optional()
    .describe("Optional document IDs of image documents to convert."),
  layout: z
    .enum(["fit", "a4", "letter"])
    .optional()
    .default("fit")
    .describe(
      'Page sizing layout: "fit" (match image aspect), "a4" (standard A4), or "letter" (US Letter).'
    ),
  margin: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Page margin in points (default 0 for fit, 28 for a4/letter)."),
  title: z
    .string()
    .optional()
    .describe("Title for the generated PDF document."),
});

export const metadataSchema = z.object({});

export type MergeInput = z.input<typeof mergeSchema>;
export type SplitInput = z.input<typeof splitSchema>;
export type ArrangeInput = z.input<typeof arrangeSchema>;
export type RotatePdfInput = z.input<typeof rotateSchema>;
export type ExtractTextInput = z.input<typeof extractTextSchema>;
export type ImagesToPdfInput = z.input<typeof imagesToPdfSchema>;

export type PdfAction =
  | "merge"
  | "split"
  | "arrange"
  | "rotate"
  | "extract_text"
  | "get_metadata"
  | "images_to_pdf";

export type PdfOperationPayload = {
  /** Storage key of the produced PDF. */
  storageKey: string;
  /** Signed URL for immediate preview/download. */
  url: string;
  filename: string;
  pages: number;
  sizeBytes: number;
};

export type PdfOperationResponse = {
  success: true;
  documentId?: string;
  persisted: boolean;
  result?: PdfOperationPayload;
  /** Present for `split`, which produces one file per group. */
  results?: PdfOperationPayload[];
  text?: { pages: { page: number; text: string }[]; text: string };
  metadata?: {
    pages: number;
    sizeBytes: number;
    title?: string;
    author?: string;
    wasEncrypted?: boolean;
  };
};
