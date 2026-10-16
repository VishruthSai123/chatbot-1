import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  getDocumentById,
  getLatestDocumentByKind,
  getMessagesByChatId,
  saveDocument,
} from "@/lib/db/queries";
import {
  type DpiOption,
  getPresetByKey,
  type PhysicalUnit,
} from "@/lib/image/presets";
import {
  executeCompress,
  executeCrop,
  executeRemoveBg,
  executeResizePhysical,
} from "@/lib/tools/image";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type ImageToolsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId?: string;
};

async function resolveImageSource(
  session: Session,
  documentId?: string,
  imageUrl?: string,
  chatId?: string
): Promise<{ source: string; documentId: string; title: string }> {
  if (!session.user?.id) {
    throw new Error("Unauthorized");
  }

  // 1. Direct image URL provided
  if (imageUrl) {
    const docId = documentId || generateUUID();
    return {
      documentId: docId,
      source: imageUrl,
      title: "Processed Photo",
    };
  }

  // 2. Document by ID
  if (documentId) {
    const doc = await getDocumentById({ id: documentId });
    if (doc && doc.userId === session.user.id && doc.content) {
      return {
        documentId: doc.id,
        source: doc.content,
        title: doc.title,
      };
    }
  }

  // 3. Fall back to the most recent image in the chat (either from previous tool output or attachment)
  if (chatId) {
    try {
      const messages = await getMessagesByChatId({ id: chatId });
      let foundOutputDocId: string | undefined;
      let foundAttachmentUrl: { url: string; name?: string } | undefined;

      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts as any[]) {
            if (part.type?.startsWith("tool-image") && part.output?.id) {
              foundOutputDocId = part.output.id;
              break;
            }
            if (
              !foundAttachmentUrl &&
              (part.type === "file" || part.type === "image") &&
              (part.url || part.data)
            ) {
              foundAttachmentUrl = {
                name: part.name,
                url: part.url || part.data,
              };
            }
          }
        }
        if (foundOutputDocId) {
          break;
        }
      }

      if (foundOutputDocId) {
        const doc = await getDocumentById({ id: foundOutputDocId });
        if (doc?.content) {
          return {
            documentId: doc.id,
            source: doc.content,
            title: doc.title,
          };
        }
      }

      if (foundAttachmentUrl) {
        const docId = generateUUID();
        return {
          documentId: docId,
          source: foundAttachmentUrl.url,
          title: foundAttachmentUrl.name || "Attached Photo",
        };
      }
    } catch (err) {
      console.warn("Failed to retrieve chat messages for image fallback:", err);
    }
  }

  // 4. Fall back to most recent image document in DB
  try {
    const latest = await getLatestDocumentByKind({
      kind: "image",
      userId: session.user.id,
    });
    if (latest?.content) {
      return {
        documentId: latest.id,
        source: latest.content,
        title: latest.title,
      };
    }
  } catch (err) {
    console.warn("Failed to query latest image document:", err);
  }

  throw new Error(
    "No active image found. Please upload a photo or provide an image URL first."
  );
}

export const imageResizePhysical = ({
  session,
  dataStream,
  chatId,
}: ImageToolsProps) =>
  tool({
    description:
      "Resize an image to exact physical dimensions (mm, cm, in, px) and embed target DPI metadata into the file. Ideal for passport photos, visa applications, ID cards, and high-res print specs.",
    execute: async ({
      id,
      imageUrl,
      preset,
      width,
      height,
      unit = "mm",
      dpi = 300,
    }) => {
      try {
        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(session, id, imageUrl, chatId);
        } catch (err: any) {
          return { error: err.message };
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
            error:
              "Width and height or a valid preset (e.g. 'indian_passport', 'us_visa') must be provided.",
          };
        }

        const result = await executeResizePhysical(resolved.source, {
          dpi: finalDpi,
          fit: "cover",
          format: "jpeg",
          height: finalHeight,
          quality: 95,
          unit: finalUnit,
          width: finalWidth,
        });

        // Save version to DB non-fatally
        try {
          await saveDocument({
            content: result.base64,
            id: resolved.documentId,
            kind: "image",
            title: resolved.title,
            userId: session.user?.id as string,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist resized document:", dbErr);
        }

        // Emit UI updates to open Right Pane studio
        dataStream.write({ data: "image", transient: true, type: "data-kind" });
        dataStream.write({
          data: resolved.documentId,
          transient: true,
          type: "data-id",
        });
        dataStream.write({
          data: resolved.title,
          transient: true,
          type: "data-title",
        });
        dataStream.write({
          data: "resize",
          transient: true,
          type: "data-imageToolMode",
        });
        dataStream.write({ data: null, transient: true, type: "data-clear" });
        dataStream.write({
          data: result.base64,
          transient: true,
          type: "data-imageDelta",
        });
        dataStream.write({ data: null, transient: true, type: "data-finish" });

        return {
          dimensions: `${finalWidth}x${finalHeight} ${finalUnit}`,
          dpi: finalDpi,
          id: resolved.documentId,
          message: `Successfully resized image to ${finalWidth}×${finalHeight} ${finalUnit} (${result.width}×${result.height} px @ ${finalDpi} DPI).`,
          pixelDimensions: `${result.width}x${result.height} px`,
          sizeKb: Math.round(result.sizeBytes / 1024),
          toolMode: "resize",
        };
      } catch (err: any) {
        console.error("Resize tool execution error:", err);
        return { error: err.message || "Failed to resize photo" };
      }
    },
    inputSchema: z.object({
      dpi: z
        .union([z.literal(72), z.literal(150), z.literal(300), z.literal(600)])
        .optional()
        .default(300),
      height: z
        .number()
        .positive()
        .optional()
        .describe("Height in physical units"),
      id: z
        .string()
        .optional()
        .describe(
          "ID of the image artifact. If omitted, uses active/recent image."
        ),
      imageUrl: z
        .string()
        .optional()
        .describe("Direct URL or signed URL of the image to process"),
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
        .describe(
          "Official photo preset for visa/passport standard dimensions"
        ),
      unit: z.enum(["mm", "cm", "in", "px"]).optional().default("mm"),
      width: z
        .number()
        .positive()
        .optional()
        .describe("Width in physical units"),
    }),
  });

export const imageRemoveBg = ({
  session,
  dataStream,
  chatId,
}: ImageToolsProps) =>
  tool({
    description:
      "Remove the background of an image using native neural segmentation. Can produce transparent alpha PNG or composite onto solid passport-compliant white/neutral background.",
    execute: async ({
      id,
      imageUrl,
      mode = "transparent",
      color = "#ffffff",
    }) => {
      try {
        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(session, id, imageUrl, chatId);
        } catch (err: any) {
          return { error: err.message };
        }

        const result = await executeRemoveBg(resolved.source, {
          color,
          format: mode === "solid_color" ? "jpeg" : "png",
          mode,
          quality: 95,
        });

        // Save version non-fatally
        try {
          await saveDocument({
            content: result.base64,
            id: resolved.documentId,
            kind: "image",
            title: resolved.title,
            userId: session.user?.id as string,
          });
        } catch (dbErr) {
          console.warn(
            "Non-fatal: Failed to persist removeBg document:",
            dbErr
          );
        }

        // Emit UI updates
        dataStream.write({ data: "image", transient: true, type: "data-kind" });
        dataStream.write({
          data: resolved.documentId,
          transient: true,
          type: "data-id",
        });
        dataStream.write({
          data: resolved.title,
          transient: true,
          type: "data-title",
        });
        dataStream.write({
          data: "remove_bg",
          transient: true,
          type: "data-imageToolMode",
        });
        dataStream.write({ data: null, transient: true, type: "data-clear" });
        dataStream.write({
          data: result.base64,
          transient: true,
          type: "data-imageDelta",
        });
        dataStream.write({ data: null, transient: true, type: "data-finish" });

        return {
          color: mode === "solid_color" ? color : "transparent",
          id: resolved.documentId,
          message:
            mode === "solid_color"
              ? `Background removed and filled with solid color (${color}).`
              : "Background removed with transparent alpha cutout.",
          mode,
          sizeKb: Math.round(result.sizeBytes / 1024),
          toolMode: "remove_bg",
        };
      } catch (err: any) {
        console.error("RemoveBg tool execution error:", err);
        return { error: err.message || "Failed to remove background" };
      }
    },
    inputSchema: z.object({
      color: z
        .string()
        .optional()
        .default("#ffffff")
        .describe(
          "Hex color code when mode is 'solid_color' (e.g. '#ffffff' for passport/visa compliance)"
        ),
      id: z.string().optional().describe("ID of the image artifact"),
      imageUrl: z.string().optional().describe("Direct URL of the image"),
      mode: z
        .enum(["transparent", "solid_color"])
        .optional()
        .default("transparent"),
    }),
  });

export const imageCrop = ({ session, dataStream, chatId }: ImageToolsProps) =>
  tool({
    description:
      "Crop an image to specified rectangular coordinates (left, top, width, height).",
    execute: async ({ id, imageUrl, left, top, width, height }) => {
      try {
        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(session, id, imageUrl, chatId);
        } catch (err: any) {
          return { error: err.message };
        }

        const result = await executeCrop(resolved.source, {
          height,
          left,
          top,
          width,
        });

        try {
          await saveDocument({
            content: result.base64,
            id: resolved.documentId,
            kind: "image",
            title: resolved.title,
            userId: session.user?.id as string,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist crop document:", dbErr);
        }

        dataStream.write({ data: "image", transient: true, type: "data-kind" });
        dataStream.write({
          data: resolved.documentId,
          transient: true,
          type: "data-id",
        });
        dataStream.write({
          data: resolved.title,
          transient: true,
          type: "data-title",
        });
        dataStream.write({
          data: "crop",
          transient: true,
          type: "data-imageToolMode",
        });
        dataStream.write({ data: null, transient: true, type: "data-clear" });
        dataStream.write({
          data: result.base64,
          transient: true,
          type: "data-imageDelta",
        });
        dataStream.write({ data: null, transient: true, type: "data-finish" });

        return {
          croppedDimensions: `${result.width}x${result.height} px`,
          id: resolved.documentId,
          message: `Image cropped to ${result.width}×${result.height} px.`,
          toolMode: "crop",
        };
      } catch (err: any) {
        console.error("Crop tool execution error:", err);
        return { error: err.message || "Failed to crop photo" };
      }
    },
    inputSchema: z.object({
      height: z.number().positive(),
      id: z.string().optional(),
      imageUrl: z.string().optional(),
      left: z.number().min(0),
      top: z.number().min(0),
      width: z.number().positive(),
    }),
  });

export const imageCompress = ({
  session,
  dataStream,
  chatId,
}: ImageToolsProps) =>
  tool({
    description:
      "Compress an image to fit under a specific file size threshold in KB (e.g. 50 KB for government portals) or reduce quality.",
    execute: async ({ id, imageUrl, targetSizeKb, quality = 80 }) => {
      try {
        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(session, id, imageUrl, chatId);
        } catch (err: any) {
          return { error: err.message };
        }

        const result = await executeCompress(resolved.source, {
          quality,
          targetSizeKb,
        });

        try {
          await saveDocument({
            content: result.base64,
            id: resolved.documentId,
            kind: "image",
            title: resolved.title,
            userId: session.user?.id as string,
          });
        } catch (dbErr) {
          console.warn(
            "Non-fatal: Failed to persist compress document:",
            dbErr
          );
        }

        dataStream.write({ data: "image", transient: true, type: "data-kind" });
        dataStream.write({
          data: resolved.documentId,
          transient: true,
          type: "data-id",
        });
        dataStream.write({
          data: resolved.title,
          transient: true,
          type: "data-title",
        });
        dataStream.write({
          data: "compress",
          transient: true,
          type: "data-imageToolMode",
        });
        dataStream.write({ data: null, transient: true, type: "data-clear" });
        dataStream.write({
          data: result.base64,
          transient: true,
          type: "data-imageDelta",
        });
        dataStream.write({ data: null, transient: true, type: "data-finish" });

        const finalSizeKb = Math.round(result.sizeBytes / 1024);
        return {
          id: resolved.documentId,
          message: `Image compressed to ${finalSizeKb} KB.`,
          sizeKb: finalSizeKb,
          toolMode: "compress",
        };
      } catch (err: any) {
        console.error("Compress tool execution error:", err);
        return { error: err.message || "Failed to compress photo" };
      }
    },
    inputSchema: z.object({
      id: z.string().optional(),
      imageUrl: z.string().optional(),
      quality: z.number().min(1).max(100).optional().default(80),
      targetSizeKb: z
        .number()
        .positive()
        .optional()
        .describe("Target maximum file size in KB"),
    }),
  });
