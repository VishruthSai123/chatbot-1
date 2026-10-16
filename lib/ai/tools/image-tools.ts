import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { guestRegex } from "@/lib/constants";
import {
  getDocumentById,
  getLatestDocumentByKind,
  getMessagesByChatId,
  isValidUUID,
  saveDocument,
} from "@/lib/db/queries";
import {
  type DpiOption,
  getPresetByKey,
  type PhysicalUnit,
} from "@/lib/image/presets";
import { activeImageRegistry } from "@/lib/image/session-registry";
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
  messages?: ChatMessage[];
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

function isInternalModelUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }
  const lower = url.toLowerCase();
  return (
    lower.includes("gemini.google.com") ||
    lower.includes("generativelanguage.googleapis.com") ||
    lower.includes("googleapis.com") ||
    lower.includes("/api/content/references") ||
    lower.includes("googleusercontent.com")
  );
}

async function resolveImageSource(
  session: Session,
  documentId?: string,
  imageUrl?: string,
  chatId?: string,
  messagesContext?: ChatMessage[]
): Promise<{ source: string; documentId: string; title: string }> {
  if (!session.user?.id) {
    throw new Error("Unauthorized");
  }

  // 1. Gather all candidate messages from context or database
  let candidateMessages: any[] = messagesContext || [];
  if (candidateMessages.length === 0 && chatId && isValidUUID(chatId)) {
    try {
      const dbMsgs = await getMessagesByChatId({ id: chatId });
      candidateMessages = dbMsgs;
    } catch (err) {
      console.warn("Non-fatal: Failed to query chat messages for image:", err);
    }
  }

  // Detect whether the user explicitly typed an external URL in their prompt
  const [lastUserMsg] = candidateMessages
    .filter((m: any) => m.role === "user")
    .slice(-1);
  const lastUserText = lastUserMsg?.parts
    ? lastUserMsg.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ")
    : typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "";
  const userExplicitlyTypedUrl = /https?:\/\/[^\s]+/i.test(lastUserText);

  // Sanitize imageUrl: Ignore internal AI model reference URLs
  const cleanImageUrl =
    imageUrl && !isInternalModelUrl(imageUrl) ? imageUrl.trim() : undefined;

  // 2. If an explicit document UUID was provided, look it up in active registry or database
  if (documentId && isValidUUID(documentId)) {
    const cachedByDocId = activeImageRegistry.getActiveImage({ documentId });
    if (cachedByDocId?.base64) {
      return {
        documentId,
        source: cachedByDocId.base64,
        title: cachedByDocId.title || "Photo",
      };
    }

    try {
      const doc = await getDocumentById({ id: documentId });
      if (doc && doc.userId === session.user.id && doc.content) {
        activeImageRegistry.setActiveImage({
          base64: doc.content,
          chatId,
          documentId: doc.id,
          title: doc.title,
          userId: session.user.id,
        });
        return {
          documentId: doc.id,
          source: doc.content,
          title: doc.title,
        };
      }
    } catch (docErr) {
      console.warn("Non-fatal: Document lookup error:", docErr);
    }
  }

  // 3. Search conversation messages in reverse chronological order
  if (candidateMessages.length > 0) {
    const targetName =
      documentId && !isValidUUID(documentId)
        ? documentId.trim().toLowerCase()
        : null;

    // A) If a filename hint was passed, search for matching attachments or parts
    if (targetName) {
      for (let i = candidateMessages.length - 1; i >= 0; i -= 1) {
        const msg = candidateMessages[i];
        if (Array.isArray(msg.attachments)) {
          for (const att of msg.attachments) {
            const name = (att.name || att.pathname || "").toLowerCase();
            if (
              att.url &&
              (name.includes(targetName) || targetName.includes(name))
            ) {
              return {
                documentId: generateUUID(),
                source: att.url,
                title: att.name || documentId || "Attached Photo",
              };
            }
          }
        }
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            const name = (part.name || "").toLowerCase();
            const url = part.url || part.data || part.image;
            if (
              url &&
              (name.includes(targetName) || targetName.includes(name))
            ) {
              return {
                documentId: generateUUID(),
                source: url,
                title: part.name || documentId || "Attached Photo",
              };
            }
          }
        }
      }
    }

    // B) Grab the most recent tool output, active image, or attachment (NEWEST FIRST)
    let candidateToolDocId: string | null = null;
    let candidateToolTitle = "Processed Photo";

    for (let i = candidateMessages.length - 1; i >= 0; i -= 1) {
      const msg = candidateMessages[i];

      // Check msg.parts (tool outputs and uploaded files)
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          const isToolPart =
            part.type?.startsWith("tool-image") ||
            (part.type === "tool-invocation" &&
              (part.toolName?.startsWith("image") ||
                part.toolInvocation?.toolName?.startsWith("image")));

          if (isToolPart) {
            const out = (part.output || part.toolInvocation?.result) as
              | Record<string, any>
              | undefined;

            if (out?.id && isValidUUID(out.id)) {
              // Check in-memory registry first
              const cached = activeImageRegistry.getActiveImage({
                documentId: out.id,
              });
              if (cached?.base64) {
                return {
                  documentId: out.id,
                  source: cached.base64,
                  title: cached.title || "Processed Photo",
                };
              }

              // Defer database lookup outside loop to satisfy noAwaitInLoops
              if (!candidateToolDocId) {
                candidateToolDocId = out.id;
                candidateToolTitle = out.title || "Processed Photo";
              }
            }

            const inlineContent =
              out?.result?.dataUrl ||
              out?.result?.base64 ||
              out?.document?.content ||
              out?.dataUrl ||
              out?.base64 ||
              out?.source;

            if (inlineContent) {
              return {
                documentId: out?.id || generateUUID(),
                source: inlineContent,
                title: out?.title || out?.document?.title || "Processed Photo",
              };
            }
          }

          if (
            (part.type === "file" || part.type === "image") &&
            (part.url || part.data || part.image)
          ) {
            // Check active session registry first (has raw uploaded buffer)
            const cached = activeImageRegistry.getActiveImage({
              chatId,
              userId: session.user.id,
            });
            if (cached?.base64) {
              return {
                documentId: cached.documentId || generateUUID(),
                source: cached.base64,
                title: cached.title || part.name || "Attached Photo",
              };
            }

            return {
              documentId: generateUUID(),
              source: part.url || part.data || part.image,
              title: part.name || "Attached Photo",
            };
          }
        }
      }

      // Check msg.attachments
      if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          const name = att.name || att.pathname || "";
          if (
            att.url &&
            (att.contentType?.startsWith("image/") ||
              /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name))
          ) {
            const cached = activeImageRegistry.getActiveImage({
              chatId,
              userId: session.user.id,
            });
            if (cached?.base64) {
              return {
                documentId: cached.documentId || generateUUID(),
                source: cached.base64,
                title: cached.title || name || "Attached Photo",
              };
            }

            return {
              documentId: generateUUID(),
              source: att.url,
              title: name || "Attached Photo",
            };
          }
        }
      }
    }

    // Lookup deferred candidate tool document from database
    if (candidateToolDocId) {
      try {
        const doc = await getDocumentById({ id: candidateToolDocId });
        if (doc?.content && doc.userId === session.user.id) {
          activeImageRegistry.setActiveImage({
            base64: doc.content,
            chatId,
            documentId: doc.id,
            title: doc.title,
            userId: session.user.id,
          });
          return {
            documentId: doc.id,
            source: doc.content,
            title: doc.title || candidateToolTitle,
          };
        }
      } catch {
        // non-fatal
      }
    }
  }

  // 4. Check active image in server-side session registry
  const sessionCached = activeImageRegistry.getActiveImage({
    chatId,
    userId: session.user.id,
  });
  if (sessionCached?.base64) {
    return {
      documentId: sessionCached.documentId || generateUUID(),
      source: sessionCached.base64,
      title: sessionCached.title || "Photo",
    };
  }

  // 5. Fall back to most recent image document in DB
  try {
    const latest = await getLatestDocumentByKind({
      kind: "image",
      userId: session.user.id,
    });
    if (latest?.content) {
      activeImageRegistry.setActiveImage({
        base64: latest.content,
        chatId,
        documentId: latest.id,
        title: latest.title,
        userId: session.user.id,
      });
      return {
        documentId: latest.id,
        source: latest.content,
        title: latest.title,
      };
    }
  } catch (err) {
    console.warn("Failed to query latest image document:", err);
  }

  // 6. Direct valid external image URL provided (if user explicitly typed it or nothing else was found)
  if (cleanImageUrl && (userExplicitlyTypedUrl || !sessionCached)) {
    const docId =
      documentId && isValidUUID(documentId) ? documentId : generateUUID();
    return {
      documentId: docId,
      source: cleanImageUrl,
      title: "Processed Photo",
    };
  }

  throw new Error(
    "No active image found. Please upload a photo or provide an image URL first."
  );
}

export const imageResizePhysical = ({
  session,
  dataStream,
  chatId,
  messages,
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
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Physical photo resizing (passport/visa presets & DPI injection) is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id,
            imageUrl,
            chatId,
            messages
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

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

        const result = await executeResizePhysical(
          resolved.source,
          {
            dpi: finalDpi,
            fit: "cover",
            format: "jpeg",
            height: finalHeight,
            quality: 95,
            unit: finalUnit,
            width: finalWidth,
          },
          {
            chatId,
            documentId: validDocId,
            userId: session.user?.id as string,
          }
        );

        // Pin active result in session registry immediately
        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        // Save version to DB non-fatally
        try {
          await saveDocument({
            content: result.base64,
            id: validDocId,
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
          data: validDocId,
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
          id: validDocId,
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
          "Document UUID of an existing image to modify. Omit when processing newly uploaded photos."
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "Public HTTP/HTTPS URL of an external web image. DO NOT supply for uploaded photos or internal model references."
        ),
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
  messages,
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
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: AI background removal is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id,
            imageUrl,
            chatId,
            messages
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeRemoveBg(
          resolved.source,
          {
            color,
            format: mode === "solid_color" ? "jpeg" : "png",
            mode,
            quality: 95,
          },
          {
            chatId,
            documentId: validDocId,
            userId: session.user?.id as string,
          }
        );

        // Pin active result in session registry immediately
        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        // Save version non-fatally
        try {
          await saveDocument({
            content: result.base64,
            id: validDocId,
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
          data: validDocId,
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
          id: validDocId,
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
      id: z
        .string()
        .optional()
        .describe(
          "Document UUID of an existing image to modify. Omit when processing newly uploaded photos."
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "Public HTTP/HTTPS URL of an external web image. DO NOT supply for uploaded photos or internal model references."
        ),
      mode: z
        .enum(["transparent", "solid_color"])
        .optional()
        .default("transparent"),
    }),
  });

export const imageCrop = ({
  session,
  dataStream,
  chatId,
  messages,
}: ImageToolsProps) =>
  tool({
    description:
      "Crop an image to specified rectangular coordinates (left, top, width, height).",
    execute: async ({ id, imageUrl, left, top, width, height }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image cropping tools are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id,
            imageUrl,
            chatId,
            messages
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeCrop(
          resolved.source,
          {
            height,
            left,
            top,
            width,
          },
          {
            chatId,
            documentId: validDocId,
            userId: session.user?.id as string,
          }
        );

        // Pin active result in session registry immediately
        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await saveDocument({
            content: result.base64,
            id: validDocId,
            kind: "image",
            title: resolved.title,
            userId: session.user?.id as string,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist crop document:", dbErr);
        }

        dataStream.write({ data: "image", transient: true, type: "data-kind" });
        dataStream.write({
          data: validDocId,
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
          id: validDocId,
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
      id: z
        .string()
        .optional()
        .describe(
          "Document UUID of an existing image to modify. Omit when processing newly uploaded photos."
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "Public HTTP/HTTPS URL of an external web image. DO NOT supply for uploaded photos or internal model references."
        ),
      left: z.number().min(0),
      top: z.number().min(0),
      width: z.number().positive(),
    }),
  });

export const imageCompress = ({
  session,
  dataStream,
  chatId,
  messages,
}: ImageToolsProps) =>
  tool({
    description:
      "Compress an image to fit under a specific file size threshold in KB (e.g. 50 KB for government portals) or reduce quality.",
    execute: async ({ id, imageUrl, targetSizeKb, quality = 80 }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image compression features are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id,
            imageUrl,
            chatId,
            messages
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeCompress(
          resolved.source,
          {
            quality,
            targetSizeKb,
          },
          {
            chatId,
            documentId: validDocId,
            userId: session.user?.id as string,
          }
        );

        // Pin active result in session registry immediately
        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await saveDocument({
            content: result.base64,
            id: validDocId,
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
          data: validDocId,
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
          id: validDocId,
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
      id: z
        .string()
        .optional()
        .describe(
          "Document UUID of an existing image to modify. Omit when processing newly uploaded photos."
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "Public HTTP/HTTPS URL of an external web image. DO NOT supply for uploaded photos or internal model references."
        ),
      quality: z.number().min(1).max(100).optional().default(80),
      targetSizeKb: z
        .number()
        .positive()
        .optional()
        .describe("Target maximum file size in KB"),
    }),
  });
