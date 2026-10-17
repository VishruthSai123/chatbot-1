import { z } from "zod";

export const physicalUnitSchema = z.enum(["px", "cm", "mm", "in"]);
export const dpiOptionSchema = z.union([
  z.literal(72),
  z.literal(150),
  z.literal(300),
  z.literal(600),
]);
export const imageFormatSchema = z.enum([
  "jpeg",
  "png",
  "webp",
  "avif",
  "tiff",
]);
export const resizeFitSchema = z.enum([
  "cover",
  "contain",
  "fill",
  "inside",
  "outside",
  "pad",
]);

export const hexColorSchema = z
  .string()
  .regex(
    /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
    "Must be a valid hex color code"
  );

/**
 * Superset resize schema covering every dimension request shape:
 * exact px, physical units + DPI, aspect ratio, relative scale, bounded fit,
 * and named presets — plus an optional post-resize file-size bound.
 *
 * All geometry fields are optional; at least one must be supplied.
 */
export const resizeSchema = z
  .object({
    allowUpscale: z
      .boolean()
      .optional()
      .describe("When false, the image is never enlarged beyond its source."),
    aspectRatio: z
      .string()
      .optional()
      .describe('Target aspect ratio, e.g. "16:9", "4:5", "1:1", "square".'),
    dpi: dpiOptionSchema.optional().default(300),
    fit: resizeFitSchema.optional().default("cover"),
    format: imageFormatSchema.optional().default("jpeg"),
    height: z
      .number()
      .positive()
      .optional()
      .describe("Exact target height in `unit`."),
    maxHeight: z
      .number()
      .positive()
      .optional()
      .describe("Upper bound for height, preserving aspect ratio."),
    maxLongEdge: z
      .number()
      .positive()
      .optional()
      .describe("Clamp the longest edge to this many pixels."),
    maxWidth: z
      .number()
      .positive()
      .optional()
      .describe("Upper bound for width, preserving aspect ratio."),
    minHeight: z.number().positive().optional(),
    minWidth: z.number().positive().optional(),
    padColor: hexColorSchema
      .optional()
      .describe('Fill colour for fit "pad" (default "#ffffff").'),
    preset: z
      .string()
      .optional()
      .describe(
        "Named standard preset key, e.g. indian_passport, us_visa, schengen_visa, uk_visa, stamp_size, pan_card, photo_4x6."
      ),
    quality: z.number().min(1).max(100).optional().default(95),
    scalePercent: z
      .number()
      .positive()
      .optional()
      .describe("Relative scale, e.g. 50 (half) or 200 (double)."),
    targetSizeKb: z
      .number()
      .positive()
      .optional()
      .describe("Optional maximum file size (KB) applied after resizing."),
    unit: physicalUnitSchema.optional().default("px"),
    width: z
      .number()
      .positive()
      .optional()
      .describe("Exact target width in `unit`."),
  })
  .refine(
    (value) =>
      value.preset !== undefined ||
      value.aspectRatio !== undefined ||
      value.scalePercent !== undefined ||
      value.maxLongEdge !== undefined ||
      value.maxWidth !== undefined ||
      value.maxHeight !== undefined ||
      value.minWidth !== undefined ||
      value.minHeight !== undefined ||
      value.width !== undefined ||
      value.height !== undefined,
    {
      message:
        "Provide a width, height, aspectRatio, scalePercent, max/min bound, or preset.",
    }
  );
export type ResizeInput = z.input<typeof resizeSchema>;

export const removeBgSchema = z.object({
  color: hexColorSchema.optional().default("#ffffff"),
  format: imageFormatSchema.optional().default("png"),
  mode: z
    .enum(["transparent", "solid_color"])
    .optional()
    .default("transparent"),
  quality: z.number().min(1).max(100).optional().default(95),
});
export type RemoveBgInput = z.input<typeof removeBgSchema>;

export const cropModeSchema = z.enum([
  "center",
  "top",
  "bottom",
  "attention",
  "entropy",
]);

/**
 * Crop schema. Supply EITHER an `aspectRatio` (largest matching region, anchored
 * by `mode`) OR explicit pixel coordinates (`left`/`top`/`width`/`height`).
 */
export const cropSchema = z
  .object({
    aspectRatio: z
      .string()
      .optional()
      .describe('Crop to an aspect ratio, e.g. "1:1", "16:9", "7:9".'),
    format: imageFormatSchema.optional().default("jpeg"),
    height: z.number().positive().optional(),
    left: z.number().min(0).optional(),
    mode: cropModeSchema
      .optional()
      .default("center")
      .describe(
        "Anchor for aspect-ratio crops; 'attention'/'entropy' pick the busiest region."
      ),
    quality: z.number().min(1).max(100).optional().default(95),
    top: z.number().min(0).optional(),
    width: z.number().positive().optional(),
  })
  .refine(
    (value) =>
      value.aspectRatio !== undefined ||
      (value.left !== undefined &&
        value.top !== undefined &&
        value.width !== undefined &&
        value.height !== undefined),
    {
      message: "Provide an aspectRatio, or all of left, top, width and height.",
    }
  );
export type CropInput = z.input<typeof cropSchema>;

export const rotateSchema = z.object({
  background: hexColorSchema
    .optional()
    .default("#ffffff")
    .describe("Fill colour for corners exposed by arbitrary-angle rotation."),
  degrees: z
    .number()
    .min(-360)
    .max(360)
    .optional()
    .default(0)
    .describe("Rotation angle in degrees (any value, not just 90/180/270)."),
  flipHorizontal: z.boolean().optional().default(false),
  flipVertical: z.boolean().optional().default(false),
  format: imageFormatSchema.optional().default("jpeg"),
  quality: z.number().min(1).max(100).optional().default(95),
});
export type RotateInput = z.input<typeof rotateSchema>;

export const compressSchema = z.object({
  format: imageFormatSchema.optional().default("jpeg"),
  quality: z.number().min(1).max(100).optional().default(80),
  targetSizeKb: z.number().positive().optional(),
});
export type CompressInput = z.input<typeof compressSchema>;

export const convertSchema = z.object({
  quality: z.number().min(1).max(100).optional().default(95),
  targetFormat: imageFormatSchema,
});
export type ConvertInput = z.input<typeof convertSchema>;

/**
 * Upscale/enhance schema. Choose ONE sizing intent: a multiplier (`scale`), an
 * exact `targetWidth`/`targetHeight`, or a `maxLongEdge` clamp. Explicit targets
 * take precedence over `scale`.
 */
export const upscaleSchema = z.object({
  enhance: z.boolean().optional().default(false),
  format: imageFormatSchema.optional().default("jpeg"),
  maxLongEdge: z
    .number()
    .positive()
    .optional()
    .describe("Clamp the longest edge to this many pixels."),
  quality: z.number().min(1).max(100).optional().default(95),
  scale: z
    .number()
    .min(1)
    .max(8)
    .optional()
    .default(2)
    .describe("Upscale multiplier (1-8)."),
  sharpen: z.boolean().optional().default(true),
  targetHeight: z.number().positive().optional(),
  targetWidth: z.number().positive().optional(),
});
export type UpscaleInput = z.input<typeof upscaleSchema>;

export const pixelateSchema = z.object({
  blockSize: z.number().min(2).max(64).optional().default(12),
  format: imageFormatSchema.optional().default("png"),
  mode: z.enum(["mosaic", "blur"]).optional().default("mosaic"),
  quality: z.number().min(1).max(100).optional().default(95),
});
export type PixelateInput = z.input<typeof pixelateSchema>;

export const ocrSchema = z.object({
  format: z.enum(["markdown", "plain"]).optional().default("markdown"),
});
export type OcrInput = z.input<typeof ocrSchema>;

export interface OcrOperationResult {
  model: string;
  text: string;
  wordCount: number;
}

export interface ImageOperationResult {
  base64: string;
  dataUrl: string;
  density?: number;
  format: string;
  height: number;
  sizeBytes: number;
  width: number;
}
