import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById, getLatestDocumentByKind, saveDocument } from "@/lib/db/queries";
import { getPresetByKey, type PhysicalUnit, type DpiOption } from "@/lib/image/presets";
import {
  executeCompress,
  executeCrop,
  executeRemoveBg,
  executeResizePhysical,
} from "@/lib/tools/image";
import type { ChatMessage } from "@/lib/types";

type ImageToolsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

async function resolveImageDocument(
  session: Session,
  documentId?: string
) {
  if (!session.user?.id) {
    throw new Error("Unauthorized");
  }

  if (documentId) {
    const doc = await getDocumentById({ id: documentId });
    if (doc && doc.userId === session.user.id) {
      return doc;
    }
  }

  // Fall back to most recent image document
  const latest = await getLatestDocumentByKind({
    userId: session.user.id,
    kind: "image",
  });

  return latest;
}

export const imageResizePhysical = ({ session, dataStream }: ImageToolsProps) =>
  tool({
    description:
      "Resize an image to exact physical dimensions (mm, cm, in, px) and embed target DPI metadata into the file. Ideal for passport photos, visa applications, ID cards, and high-res print specs.",
    execute: async ({
      id,
      preset,
      width,
      height,
      unit = "mm",
      dpi = 300,
    }) => {
      const document = await resolveImageDocument(session, id);
      if (!document || !document.content) {
        return { error: "No active image found to resize. Please select or upload an image first." };
      }

      let finalWidth = width;
      let finalHeight = height;
      let finalUnit = unit as PhysicalUnit;
      let finalDpi = dpi as DpiOption;

      if (preset) {
        const found = getPresetByKey(preset);
        if (found) {
          finalWidth = found.width;
          finalHeight = found.height;
          finalUnit = found.unit;
          finalDpi = found.dpi;
        }
      }

      if (!finalWidth || !finalHeight) {
        return {
          error: "Width and height or a valid preset (e.g. 'indian_passport', 'us_visa') must be provided.",
        };
      }

      const result = await executeResizePhysical(document.content, {
        width: finalWidth,
        height: finalHeight,
        unit: finalUnit,
        dpi: finalDpi,
        fit: "cover",
        format: "jpeg",
        quality: 95,
      });

      // Save version
      await saveDocument({
        content: result.base64,
        id: document.id,
        kind: "image",
        title: document.title,
        userId: session.user!.id,
      });

      // Emit UI updates
      dataStream.write({ data: "image", transient: true, type: "data-kind" });
      dataStream.write({ data: document.id, transient: true, type: "data-id" });
      dataStream.write({ data: document.title, transient: true, type: "data-title" });
      dataStream.write({ data: null, transient: true, type: "data-clear" });
      dataStream.write({
        data: result.base64,
        transient: true,
        type: "data-imageDelta",
      });
      dataStream.write({ data: null, transient: true, type: "data-finish" });

      return {
        id: document.id,
        dimensions: `${finalWidth}x${finalHeight} ${finalUnit}`,
        pixelDimensions: `${result.width}x${result.height} px`,
        dpi: finalDpi,
        sizeKb: Math.round(result.sizeBytes / 1024),
        message: `Successfully resized image to ${finalWidth}×${finalHeight} ${finalUnit} (${result.width}×${result.height} px @ ${finalDpi} DPI).`,
      };
    },
    inputSchema: z.object({
      id: z.string().optional().describe("ID of the image artifact. If omitted, uses active/recent image."),
      preset: z
        .enum([
          "indian_passport",
          "us_visa",
          "schengen_visa",
          "uk_visa",
          "stamp_size",
          "pan_card",
          "photo_4x6",
        ])
        .optional()
        .describe("Official photo preset for visa/passport standard dimensions"),
      width: z.number().positive().optional().describe("Width in physical units"),
      height: z.number().positive().optional().describe("Height in physical units"),
      unit: z.enum(["mm", "cm", "in", "px"]).optional().default("mm"),
      dpi: z.union([z.literal(72), z.literal(150), z.literal(300), z.literal(600)]).optional().default(300),
    }),
  });

export const imageRemoveBg = ({ session, dataStream }: ImageToolsProps) =>
  tool({
    description:
      "Remove the background of an image using native neural segmentation. Can produce transparent alpha PNG or composite onto solid passport-compliant white/neutral background.",
    execute: async ({ id, mode = "transparent", color = "#ffffff" }) => {
      const document = await resolveImageDocument(session, id);
      if (!document || !document.content) {
        return { error: "No active image found. Please upload or select an image first." };
      }

      const result = await executeRemoveBg(document.content, {
        mode,
        color,
        format: mode === "solid_color" ? "jpeg" : "png",
        quality: 95,
      });

      // Save version
      await saveDocument({
        content: result.base64,
        id: document.id,
        kind: "image",
        title: document.title,
        userId: session.user!.id,
      });

      // Emit UI updates
      dataStream.write({ data: "image", transient: true, type: "data-kind" });
      dataStream.write({ data: document.id, transient: true, type: "data-id" });
      dataStream.write({ data: document.title, transient: true, type: "data-title" });
      dataStream.write({ data: null, transient: true, type: "data-clear" });
      dataStream.write({
        data: result.base64,
        transient: true,
        type: "data-imageDelta",
      });
      dataStream.write({ data: null, transient: true, type: "data-finish" });

      return {
        id: document.id,
        mode,
        color: mode === "solid_color" ? color : "transparent",
        sizeKb: Math.round(result.sizeBytes / 1024),
        message:
          mode === "solid_color"
            ? `Background removed and filled with solid color (${color}).`
            : "Background removed with transparent alpha cutout.",
      };
    },
    inputSchema: z.object({
      id: z.string().optional().describe("ID of the image artifact"),
      mode: z.enum(["transparent", "solid_color"]).optional().default("transparent"),
      color: z
        .string()
        .optional()
        .default("#ffffff")
        .describe("Hex color code when mode is 'solid_color' (e.g. '#ffffff' for passport/visa compliance)"),
    }),
  });

export const imageCrop = ({ session, dataStream }: ImageToolsProps) =>
  tool({
    description: "Crop an image to specified rectangular coordinates (left, top, width, height).",
    execute: async ({ id, left, top, width, height }) => {
      const document = await resolveImageDocument(session, id);
      if (!document || !document.content) {
        return { error: "No active image found to crop." };
      }

      const result = await executeCrop(document.content, {
        left,
        top,
        width,
        height,
      });

      await saveDocument({
        content: result.base64,
        id: document.id,
        kind: "image",
        title: document.title,
        userId: session.user!.id,
      });

      dataStream.write({ data: "image", transient: true, type: "data-kind" });
      dataStream.write({ data: document.id, transient: true, type: "data-id" });
      dataStream.write({ data: document.title, transient: true, type: "data-title" });
      dataStream.write({ data: null, transient: true, type: "data-clear" });
      dataStream.write({
        data: result.base64,
        transient: true,
        type: "data-imageDelta",
      });
      dataStream.write({ data: null, transient: true, type: "data-finish" });

      return {
        id: document.id,
        croppedDimensions: `${result.width}x${result.height} px`,
        message: `Image cropped to ${result.width}×${result.height} px.`,
      };
    },
    inputSchema: z.object({
      id: z.string().optional(),
      left: z.number().min(0),
      top: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  });

export const imageCompress = ({ session, dataStream }: ImageToolsProps) =>
  tool({
    description:
      "Compress an image to fit under a specific file size threshold in KB (e.g. 50 KB for government portals) or reduce quality.",
    execute: async ({ id, targetSizeKb, quality = 80 }) => {
      const document = await resolveImageDocument(session, id);
      if (!document || !document.content) {
        return { error: "No active image found to compress." };
      }

      const result = await executeCompress(document.content, {
        targetSizeKb,
        quality,
      });

      await saveDocument({
        content: result.base64,
        id: document.id,
        kind: "image",
        title: document.title,
        userId: session.user!.id,
      });

      dataStream.write({ data: "image", transient: true, type: "data-kind" });
      dataStream.write({ data: document.id, transient: true, type: "data-id" });
      dataStream.write({ data: document.title, transient: true, type: "data-title" });
      dataStream.write({ data: null, transient: true, type: "data-clear" });
      dataStream.write({
        data: result.base64,
        transient: true,
        type: "data-imageDelta",
      });
      dataStream.write({ data: null, transient: true, type: "data-finish" });

      const finalSizeKb = Math.round(result.sizeBytes / 1024);
      return {
        id: document.id,
        sizeKb: finalSizeKb,
        message: `Image compressed to ${finalSizeKb} KB.`,
      };
    },
    inputSchema: z.object({
      id: z.string().optional(),
      targetSizeKb: z.number().positive().optional().describe("Target maximum file size in KB"),
      quality: z.number().min(1).max(100).optional().default(80),
    }),
  });
