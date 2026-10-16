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
]);

export const resizePhysicalSchema = z.object({
  dpi: dpiOptionSchema.optional().default(300),
  fit: resizeFitSchema.optional().default("cover"),
  format: imageFormatSchema.optional().default("jpeg"),
  height: z.number().positive("Height must be positive"),
  quality: z.number().min(1).max(100).optional().default(95),
  unit: physicalUnitSchema,
  width: z.number().positive("Width must be positive"),
});
export type ResizePhysicalInput = z.input<typeof resizePhysicalSchema>;

export const removeBgSchema = z.object({
  color: z
    .string()
    .regex(
      /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
      "Must be a valid hex color code"
    )
    .optional()
    .default("#ffffff"),
  format: imageFormatSchema.optional().default("png"),
  mode: z
    .enum(["transparent", "solid_color"])
    .optional()
    .default("transparent"),
  quality: z.number().min(1).max(100).optional().default(95),
});
export type RemoveBgInput = z.input<typeof removeBgSchema>;

export const cropSchema = z.object({
  format: imageFormatSchema.optional().default("jpeg"),
  height: z.number().positive(),
  left: z.number().min(0),
  quality: z.number().min(1).max(100).optional().default(95),
  top: z.number().min(0),
  width: z.number().positive(),
});
export type CropInput = z.input<typeof cropSchema>;

export const rotateSchema = z.object({
  degrees: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .optional()
    .default(0),
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

export interface ImageOperationResult {
  base64: string;
  dataUrl: string;
  density?: number;
  format: string;
  height: number;
  sizeBytes: number;
  width: number;
}
