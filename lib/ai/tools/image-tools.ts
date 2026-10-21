import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import type { ImageToolMode } from "@/components/chat/artifact";
import { guestRegex } from "@/lib/constants";
import {
  getDocumentById,
  getLatestDocumentByKind,
  getMessagesByChatId,
  isValidUUID,
} from "@/lib/db/queries";
import type { DimensionSpec } from "@/lib/image/dimensions";
import { persistAndSaveImageDocument } from "@/lib/image/persist";
import { findPresetsByQuery, getPresetByKey } from "@/lib/image/presets";
import { applyResizeRequirement } from "@/lib/image/requirements";
import { resolveDocumentImage } from "@/lib/image/resolve-source";
import { activeImageRegistry } from "@/lib/image/session-registry";
import {
  executeCompress,
  executeConvert,
  executeCrop,
  executeOcr,
  executePixelate,
  executeRemoveBg,
  executeResize,
  executeRotate,
  executeUpscaleEnhance,
} from "@/lib/tools/image";
import {
  executeCollage,
  executeOverlay,
  executeStitch,
} from "@/lib/tools/image/composite";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { describeBatchOutcome, runImageBatch } from "./image-batch";

type ImageToolsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId?: string;
  messages?: ChatMessage[];
  /**
   * Image currently open in the right-pane workbench, sent by the client. When the
   * model does not name a document, tools operate on this exact Document so edits
   * always target what the user is looking at.
   */
  activeImage?: {
    documentId?: string;
    toolMode?: string;
    /** 0-based index of the image version on screen; edits target that version. */
    versionIndex?: number;
  };
  /**
   * Deterministically parsed geometry from the user's latest message. Explicit
   * model arguments always win; this only fills gaps (and repairs a physical
   * request that silently defaulted to px).
   */
  requirement?: Partial<DimensionSpec>;
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

/**
 * Emits the standard transient data-stream parts that mount the right-pane
 * image workbench focused on a specific tool.
 */
function emitImageArtifact(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  payload: {
    base64?: string;
    id: string;
    mode: ImageToolMode;
    params?: Record<string, unknown>;
    title: string;
  }
) {
  dataStream.write({ data: "image", transient: true, type: "data-kind" });
  dataStream.write({ data: payload.id, transient: true, type: "data-id" });
  dataStream.write({
    data: payload.title,
    transient: true,
    type: "data-title",
  });
  dataStream.write({
    data: payload.mode,
    transient: true,
    type: "data-imageToolMode",
  });
  if (payload.params) {
    // Pre-fills the matching inspector with the exact values the model applied.
    dataStream.write({
      data: payload.params,
      transient: true,
      type: "data-imageToolParams",
    });
  }
  dataStream.write({ data: null, transient: true, type: "data-clear" });
  if (payload.base64) {
    dataStream.write({
      data: payload.base64,
      transient: true,
      type: "data-imageDelta",
    });
  }
  dataStream.write({ data: null, transient: true, type: "data-finish" });
}

async function resolveImageSource(
  session: Session,
  documentId?: string,
  imageUrl?: string,
  chatId?: string,
  messagesContext?: ChatMessage[],
  versionIndex?: number
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

  // 2. If an explicit document UUID was provided, resolve it through the shared
  // resolver so the chat tools and the workbench agree on *which* image an edit
  // applies to (exact version, registry head, or newest row — all owner-checked).
  if (documentId && isValidUUID(documentId)) {
    const resolvedDocument = await resolveDocumentImage({
      chatId,
      documentId,
      userId: session.user.id,
      versionIndex,
    });

    if (resolvedDocument) {
      return {
        documentId: resolvedDocument.documentId,
        source: resolvedDocument.base64,
        title: resolvedDocument.title,
      };
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

    // B) Grab the most recent tool output, active image, or attachment (NEWEST FIRST).
    // Stop at the FIRST (newest) candidate so an older, stale signed URL can never
    // shadow the latest edited version, and resolve document IDs before any URL fetch.
    type Candidate =
      | { kind: "inline"; source: string; documentId: string; title: string }
      | { kind: "doc"; documentId: string; title: string }
      | { kind: "url"; source: string; documentId: string; title: string };

    let candidate: Candidate | null = null;

    const registryFallback = activeImageRegistry.getActiveImage({
      chatId,
      userId: session.user.id,
    });

    for (let i = candidateMessages.length - 1; i >= 0 && !candidate; i -= 1) {
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

            const inlineContent =
              out?.result?.dataUrl ||
              out?.result?.base64 ||
              out?.document?.content ||
              out?.dataUrl ||
              out?.base64 ||
              out?.source;

            if (inlineContent) {
              candidate = {
                documentId: out?.id || generateUUID(),
                kind: "inline",
                source: inlineContent,
                title: out?.title || out?.document?.title || "Processed Photo",
              };
              break;
            }

            if (out?.id && isValidUUID(out.id)) {
              const cached = activeImageRegistry.getActiveImage({
                documentId: out.id,
              });
              candidate = cached?.base64
                ? {
                    documentId: out.id,
                    kind: "inline",
                    source: cached.base64,
                    title: cached.title || "Processed Photo",
                  }
                : {
                    documentId: out.id,
                    kind: "doc",
                    title: out.title || "Processed Photo",
                  };
              break;
            }
          }

          if (part.type === "file" || part.type === "image") {
            // Prefer an explicit document reference carried on the part
            const partDocId =
              typeof part.documentId === "string" &&
              isValidUUID(part.documentId)
                ? part.documentId
                : null;

            if (partDocId) {
              const cached = activeImageRegistry.getActiveImage({
                documentId: partDocId,
              });
              candidate = cached?.base64
                ? {
                    documentId: partDocId,
                    kind: "inline",
                    source: cached.base64,
                    title: cached.title || part.name || "Attached Photo",
                  }
                : {
                    documentId: partDocId,
                    kind: "doc",
                    title: part.name || "Attached Photo",
                  };
              break;
            }

            const partUrl = part.url || part.data || part.image;
            if (partUrl) {
              if (registryFallback?.base64) {
                candidate = {
                  documentId: registryFallback.documentId || generateUUID(),
                  kind: "inline",
                  source: registryFallback.base64,
                  title:
                    registryFallback.title || part.name || "Attached Photo",
                };
              } else {
                candidate = {
                  documentId: generateUUID(),
                  kind: "url",
                  source: partUrl,
                  title: part.name || "Attached Photo",
                };
              }
              break;
            }
          }
        }
      }

      // Check msg.attachments
      if (!candidate && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          const name = att.name || att.pathname || "";
          const isImage =
            att.url &&
            (att.contentType?.startsWith("image/") ||
              /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name));
          if (!isImage) {
            continue;
          }

          const attDocId =
            typeof att.documentId === "string" && isValidUUID(att.documentId)
              ? att.documentId
              : null;

          if (attDocId) {
            const cached = activeImageRegistry.getActiveImage({
              documentId: attDocId,
            });
            candidate = cached?.base64
              ? {
                  documentId: attDocId,
                  kind: "inline",
                  source: cached.base64,
                  title: cached.title || name || "Attached Photo",
                }
              : {
                  documentId: attDocId,
                  kind: "doc",
                  title: name || "Attached Photo",
                };
            break;
          }

          if (registryFallback?.base64) {
            candidate = {
              documentId: registryFallback.documentId || generateUUID(),
              kind: "inline",
              source: registryFallback.base64,
              title: registryFallback.title || name || "Attached Photo",
            };
          } else {
            candidate = {
              documentId: generateUUID(),
              kind: "url",
              source: att.url,
              title: name || "Attached Photo",
            };
          }
          break;
        }
      }
    }

    // Resolve the newest candidate (document IDs hit registry, then Postgres)
    if (candidate?.kind === "inline") {
      return {
        documentId: candidate.documentId,
        source: candidate.source,
        title: candidate.title,
      };
    }

    if (candidate?.kind === "doc") {
      try {
        const doc = await getDocumentById({ id: candidate.documentId });
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
            title: doc.title || candidate.title,
          };
        }
      } catch {
        // non-fatal — fall through to registry / latest-document fallbacks
      }
    }

    if (candidate?.kind === "url") {
      return {
        documentId: candidate.documentId,
        source: candidate.source,
        title: candidate.title,
      };
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

  // 6. Direct valid external image URL — ONLY when the user explicitly typed a
  // URL in their prompt. This prevents the model from echoing its own internal
  // reference URLs (e.g. gemini.google.com content references) back into a fetch.
  if (cleanImageUrl && userExplicitlyTypedUrl) {
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

export const imageResize = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
  requirement,
}: ImageToolsProps) =>
  tool({
    description:
      "Resize/re-scale an image to EXACTLY the size the user asked for, with no clarifying questions. Supports: exact pixel width/height (one or both — the missing edge keeps aspect ratio), physical units (mm/cm/in) with DPI injection, an aspect ratio (e.g. '16:9', 'square'), a relative scale percent (e.g. 50 = half, 200 = double), max/min bounds (e.g. 'max 2000px'), cover/contain/pad fit, and an optional file-size cap (targetSizeKb). Also fulfills official passport/visa/ID presets by key.",
    execute: async ({
      id,
      documentIds,
      imageUrl,
      preset,
      width,
      height,
      unit = "px",
      dpi = 300,
      aspectRatio,
      scalePercent,
      maxLongEdge,
      maxWidth,
      maxHeight,
      minWidth,
      minHeight,
      fit = "cover",
      padColor,
      allowUpscale,
      targetSizeKb,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image resizing (custom dimensions, passport/visa presets & DPI injection) is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        // Merge the deterministic NL requirement under the model's arguments
        // (explicit args win; the requirement only fills gaps and repairs a
        // physical request that defaulted to px).
        const sizing = applyResizeRequirement(
          {
            allowUpscale,
            aspectRatio,
            dpi,
            fit,
            height,
            maxHeight,
            maxLongEdge,
            maxWidth,
            minHeight,
            minWidth,
            padColor,
            preset,
            scalePercent,
            targetSizeKb,
            unit,
            width,
          },
          requirement
        );

        // Guard against a hallucinated preset key.
        const hasExplicitGeometry =
          sizing.width !== undefined ||
          sizing.height !== undefined ||
          sizing.aspectRatio !== undefined ||
          sizing.scalePercent !== undefined ||
          sizing.maxLongEdge !== undefined ||
          sizing.maxWidth !== undefined ||
          sizing.maxHeight !== undefined ||
          sizing.minWidth !== undefined ||
          sizing.minHeight !== undefined;
        if (sizing.preset && !getPresetByKey(sizing.preset)) {
          if (!hasExplicitGeometry) {
            return {
              error: `Unknown preset "${sizing.preset}". Known keys: indian_passport, passport_photo, us_visa, us_green_card, schengen_visa, uk_visa, china_visa, japan_visa, canada_visa, uae_visa, india_evisa, pan_card, stamp_size, id_photo_1inch, id_photo_35x35, photo_4x6. Call imageListPresets to look one up, or supply explicit width/height/aspectRatio.`,
            };
          }
          // Drop the bogus preset, keep the explicit geometry.
          sizing.preset = undefined;
        }

        // Batch: the same operation, applied to every listed image. The sizing
        // is already validated above, so both paths agree on what was asked for.
        if (documentIds && documentIds.length > 1) {
          const outcome = await runImageBatch({
            chatId,
            dataStream,
            documentIds,
            operation: ({ source }) =>
              executeResize(source, { ...sizing, format: "jpeg", quality: 95 }),
            session,
            title: "Resized images",
          });

          return {
            errors: outcome.errors,
            message: describeBatchOutcome(outcome, "resized"),
            processed: outcome.processed,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeResize(
          resolved.source,
          { ...sizing, format: "jpeg", quality: 95 },
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
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist resized document:", dbErr);
        }

        // Emit UI updates to open Right Pane studio
        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "resize",
          params: {
            aspectRatio: sizing.aspectRatio,
            dpi: sizing.dpi,
            fit: sizing.fit,
            height: sizing.height,
            maxLongEdge: sizing.maxLongEdge,
            maxWidth: sizing.maxWidth,
            pixelHeight: result.height,
            pixelWidth: result.width,
            preset: sizing.preset,
            scalePercent: sizing.scalePercent,
            targetSizeKb: sizing.targetSizeKb,
            unit: sizing.unit,
            width: sizing.width,
          },
          title: resolved.title,
        });

        const specLabel =
          sizing.preset ??
          sizing.aspectRatio ??
          (sizing.scalePercent ? `${sizing.scalePercent}%` : undefined) ??
          (sizing.maxLongEdge ? `max ${sizing.maxLongEdge}px` : undefined) ??
          (sizing.maxWidth || sizing.maxHeight
            ? `max ${sizing.maxWidth ?? "auto"}×${sizing.maxHeight ?? "auto"}px`
            : undefined) ??
          `${sizing.width ?? "auto"}×${sizing.height ?? "auto"} ${sizing.unit}`;

        return {
          dimensions: `${result.width}×${result.height} px`,
          dpi: sizing.dpi,
          id: validDocId,
          message: `Resized image to ${result.width}×${result.height} px (${specLabel}${sizing.targetSizeKb ? `, ≤ ${sizing.targetSizeKb} KB` : ""}).`,
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
      allowUpscale: z
        .boolean()
        .optional()
        .describe("When false, never enlarge beyond the source size."),
      aspectRatio: z
        .string()
        .optional()
        .describe(
          'Target aspect ratio, e.g. "16:9", "4:5", "1:1", "square". Combined with a single width/height it derives the other edge.'
        ),
      documentIds: z
        .array(z.string().min(1))
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Document UUIDs of several images to act on. When more than one is given, the operation applies to every one of them."
        ),
      dpi: z
        .union([z.literal(72), z.literal(150), z.literal(300), z.literal(600)])
        .optional()
        .default(300)
        .describe("DPI for physical units (mm/cm/in) and embedded density."),
      fit: z
        .enum(["cover", "contain", "fill", "inside", "outside", "pad"])
        .optional()
        .default("cover")
        .describe(
          "How to reconcile aspect mismatches. 'pad' letterboxes with padColor."
        ),
      height: z
        .number()
        .positive()
        .optional()
        .describe(
          "Exact target height in `unit`. Omit to keep the source aspect ratio."
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
      maxHeight: z.number().positive().optional(),
      maxLongEdge: z
        .number()
        .positive()
        .optional()
        .describe("Clamp the longest edge to this many pixels."),
      maxWidth: z.number().positive().optional(),
      minHeight: z.number().positive().optional(),
      minWidth: z.number().positive().optional(),
      padColor: z
        .string()
        .optional()
        .describe('Hex fill colour for fit "pad" (default "#ffffff").'),
      preset: z
        .string()
        .optional()
        .describe(
          "Official photo preset key (indian_passport, passport_photo, us_visa, us_green_card, schengen_visa, uk_visa, china_visa, japan_visa, canada_visa, uae_visa, india_evisa, pan_card, stamp_size, id_photo_1inch, id_photo_35x35, photo_4x6). Use imageListPresets first if unsure of the exact key."
        ),
      scalePercent: z
        .number()
        .positive()
        .optional()
        .describe("Relative scale: 50 = half size, 200 = double size."),
      targetSizeKb: z
        .number()
        .positive()
        .optional()
        .describe("Optional maximum file size in KB applied after resizing."),
      unit: z
        .enum(["px", "mm", "cm", "in"])
        .optional()
        .default("px")
        .describe("Unit for width/height."),
      width: z
        .number()
        .positive()
        .optional()
        .describe(
          "Exact target width in `unit`. Omit to keep the source aspect ratio."
        ),
    }),
  });

export const imageRemoveBg = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Remove the background of an image using native on-device neural segmentation. Returns a transparent alpha PNG, or composites onto a solid passport-compliant colour after edge colour decontamination. Can auto-crop to the subject. The transparent result is always written as a PNG, and later edits keep the alpha channel: if a requested format cannot store transparency (JPEG), the output falls back to PNG.",
    execute: async ({
      id,
      imageUrl,
      mode = "transparent",
      color = "#ffffff",
      edgeSmoothing,
      autoTrim,
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
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
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
            autoTrim,
            color,
            edgeSmoothing,
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
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn(
            "Non-fatal: Failed to persist removeBg document:",
            dbErr
          );
        }

        // Emit UI updates
        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "remove_bg",
          params: { autoTrim, color, edgeSmoothing, mode },
          title: resolved.title,
        });

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
      autoTrim: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Crop the result to the subject's bounding box with a small margin. Use for passport, visa and profile photos."
        ),
      color: z
        .string()
        .optional()
        .default("#ffffff")
        .describe(
          "Hex color code when mode is 'solid_color' (e.g. '#ffffff' for passport/visa compliance)"
        ),
      edgeSmoothing: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(25)
        .describe(
          "Edge character: 0 = crisp hard edge (logos, products), 100 = soft feathered edge (hair, fur)."
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
  activeImage,
  requirement,
}: ImageToolsProps) =>
  tool({
    description:
      "Crop an image. Either crop to an aspect ratio (e.g. '1:1', '16:9', '7:9') anchored by mode ('center', 'top', 'bottom', or 'attention' for smart framing), or to explicit pixel coordinates (left, top, width, height). A transparent image keeps its alpha channel.",
    execute: async ({
      id,
      documentIds,
      imageUrl,
      left,
      top,
      width,
      height,
      aspectRatio,
      mode = "center",
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image cropping tools are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        // Only borrow a ratio from the deterministic requirement when the model
        // gave neither a ratio nor a full pixel box (a ratio would otherwise
        // take precedence over an intended pixel box).
        const hasPixelBox =
          left !== undefined &&
          top !== undefined &&
          width !== undefined &&
          height !== undefined;
        const effectiveAspect =
          aspectRatio ?? (hasPixelBox ? undefined : requirement?.aspectRatio);

        // Batch: the same crop, applied to every listed image.
        if (documentIds && documentIds.length > 1) {
          const outcome = await runImageBatch({
            chatId,
            dataStream,
            documentIds,
            operation: ({ source }) =>
              executeCrop(source, {
                aspectRatio: effectiveAspect,
                height,
                left,
                mode,
                top,
                width,
              }),
            session,
            title: "Cropped images",
          });

          return {
            errors: outcome.errors,
            message: describeBatchOutcome(outcome, "cropped"),
            processed: outcome.processed,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
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
            aspectRatio: effectiveAspect,
            height,
            left,
            mode,
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
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist crop document:", dbErr);
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "crop",
          params: {
            aspectRatio: effectiveAspect,
            height,
            left,
            mode,
            top,
            width,
          },
          title: resolved.title,
        });

        return {
          croppedDimensions: `${result.width}x${result.height} px`,
          id: validDocId,
          message: `Image cropped to ${result.width}×${result.height} px${effectiveAspect ? ` (${effectiveAspect})` : ""}.`,
          toolMode: "crop",
        };
      } catch (err: any) {
        console.error("Crop tool execution error:", err);
        return { error: err.message || "Failed to crop photo" };
      }
    },
    inputSchema: z.object({
      aspectRatio: z
        .string()
        .optional()
        .describe(
          'Crop to an aspect ratio, e.g. "1:1", "16:9", "7:9", "square". Omit when using pixel coordinates.'
        ),
      documentIds: z
        .array(z.string().min(1))
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Document UUIDs of several images to act on. When more than one is given, the operation applies to every one of them."
        ),
      height: z
        .number()
        .positive()
        .optional()
        .describe("Crop height in px (required with left/top/width)."),
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
      left: z
        .number()
        .min(0)
        .optional()
        .describe("Crop x-offset in px (required with top/width/height)."),
      mode: z
        .enum(["center", "top", "bottom", "attention", "entropy"])
        .optional()
        .default("center")
        .describe(
          "Anchor for aspect-ratio crops. 'attention'/'entropy' pick the busiest region."
        ),
      top: z
        .number()
        .min(0)
        .optional()
        .describe("Crop y-offset in px (required with left/width/height)."),
      width: z
        .number()
        .positive()
        .optional()
        .describe("Crop width in px (required with left/top/height)."),
    }),
  });

export const imageRotate = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Rotate and/or flip an image. Accepts any angle in degrees (90/180/270 are exact; arbitrary angles expose corners, filled with 'background' unless the source is transparent). Also flips horizontally or vertically. A transparent image keeps its alpha channel, including transparent corners.",
    execute: async ({
      id,
      documentIds,
      imageUrl,
      degrees = 0,
      flipHorizontal = false,
      flipVertical = false,
      background = "#ffffff",
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image rotation is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        // Batch: the same rotation, applied to every listed image.
        if (documentIds && documentIds.length > 1) {
          const outcome = await runImageBatch({
            chatId,
            dataStream,
            documentIds,
            operation: ({ source }) =>
              executeRotate(source, {
                background,
                degrees,
                flipHorizontal,
                flipVertical,
              }),
            session,
            title: "Rotated images",
          });

          return {
            errors: outcome.errors,
            message: describeBatchOutcome(outcome, "rotated"),
            processed: outcome.processed,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeRotate(
          resolved.source,
          { background, degrees, flipHorizontal, flipVertical },
          {
            chatId,
            documentId: validDocId,
            userId: session.user?.id as string,
          }
        );

        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist rotate document:", dbErr);
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "rotate",
          params: { background, degrees, flipHorizontal, flipVertical },
          title: resolved.title,
        });

        const flips = [
          flipHorizontal ? "flipped horizontally" : null,
          flipVertical ? "flipped vertically" : null,
        ].filter(Boolean);
        const turns = degrees === 0 ? null : `rotated ${degrees}°`;
        const action = [turns, ...flips].filter(Boolean).join(" and ");

        return {
          id: validDocId,
          message: `Image ${action || "re-oriented"} — now ${result.width}×${result.height} px.`,
          toolMode: "rotate",
        };
      } catch (err: any) {
        console.error("Rotate tool execution error:", err);
        return { error: err.message || "Failed to rotate photo" };
      }
    },
    inputSchema: z.object({
      background: z
        .string()
        .optional()
        .default("#ffffff")
        .describe(
          "Hex fill colour for corners exposed by a non-right-angle rotation. Ignored for transparent images, which stay transparent."
        ),
      degrees: z
        .number()
        .min(-360)
        .max(360)
        .optional()
        .describe(
          "Rotation angle in degrees. Positive is clockwise. Use 90/180/270 for exact quarter turns, or any value for a free rotation. Omit for a flip-only edit."
        ),
      documentIds: z
        .array(z.string().min(1))
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Document UUIDs of several images to act on. When more than one is given, the operation applies to every one of them."
        ),
      flipHorizontal: z
        .boolean()
        .optional()
        .default(false)
        .describe("Mirror the image left-to-right."),
      flipVertical: z
        .boolean()
        .optional()
        .default(false)
        .describe("Mirror the image top-to-bottom."),
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
    }),
  });

export const imageCompress = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Compress an image to fit under a specific file size threshold in KB (e.g. 50 KB for government portals) or reduce quality. A transparent image stays transparent: request PNG or WebP for it, since JPEG cannot store an alpha channel.",
    execute: async ({
      id,
      documentIds,
      imageUrl,
      targetSizeKb,
      quality = 80,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image compression features are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        // Batch: the same compression, applied to every listed image.
        if (documentIds && documentIds.length > 1) {
          const outcome = await runImageBatch({
            chatId,
            dataStream,
            documentIds,
            operation: ({ source }) =>
              executeCompress(source, { quality, targetSizeKb }),
            session,
            title: "Compressed images",
          });

          return {
            errors: outcome.errors,
            message: describeBatchOutcome(outcome, "compressed"),
            processed: outcome.processed,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
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
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn(
            "Non-fatal: Failed to persist compress document:",
            dbErr
          );
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "compress",
          params: { quality, targetSizeKb },
          title: resolved.title,
        });

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
      documentIds: z
        .array(z.string().min(1))
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Document UUIDs of several images to act on. When more than one is given, the operation applies to every one of them."
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
      quality: z.number().min(1).max(100).optional().default(80),
      targetSizeKb: z
        .number()
        .positive()
        .optional()
        .describe("Target maximum file size in KB"),
    }),
  });

export const imageConvert = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Convert an image to a different file format (JPEG, PNG, WebP, AVIF, TIFF), preserving transparency where the target format supports it.",
    execute: async ({
      id,
      documentIds,
      imageUrl,
      targetFormat,
      quality = 95,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image format conversion is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        // Batch: the same conversion, applied to every listed image.
        if (documentIds && documentIds.length > 1) {
          const outcome = await runImageBatch({
            chatId,
            dataStream,
            documentIds,
            operation: ({ source }) =>
              executeConvert(source, { quality, targetFormat }),
            session,
            title: "Converted images",
          });

          return {
            errors: outcome.errors,
            message: describeBatchOutcome(outcome, "converted"),
            processed: outcome.processed,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeConvert(
          resolved.source,
          { quality, targetFormat },
          { chatId, documentId: validDocId, userId: session.user?.id as string }
        );

        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist convert document:", dbErr);
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "convert",
          params: { format: result.format, quality, targetFormat },
          title: resolved.title,
        });

        return {
          format: result.format,
          id: validDocId,
          message: `Converted image to ${result.format.toUpperCase()}.`,
          pixelDimensions: `${result.width}x${result.height} px`,
          sizeKb: Math.round(result.sizeBytes / 1024),
          toolMode: "convert",
        };
      } catch (err: any) {
        console.error("Convert tool execution error:", err);
        return { error: err.message || "Failed to convert photo" };
      }
    },
    inputSchema: z.object({
      documentIds: z
        .array(z.string().min(1))
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Document UUIDs of several images to act on. When more than one is given, the operation applies to every one of them."
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
      quality: z.number().min(1).max(100).optional().default(95),
      targetFormat: z.enum(["jpeg", "png", "webp", "avif", "tiff"]),
    }),
  });

export const imageUpscaleEnhance = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Upscale or enlarge an image with Lanczos super-sampling, optionally enhancing edge clarity, brightness and saturation. Specify either a multiplier (scale, 1-8), an exact target size (targetWidth/targetHeight in px), or a maxLongEdge clamp. A transparent image should be written as PNG or WebP; a JPEG request falls back to PNG so the alpha channel survives.",
    execute: async ({
      id,
      imageUrl,
      scale = 2,
      targetWidth,
      targetHeight,
      maxLongEdge,
      sharpen = true,
      enhance = false,
      format = "jpeg",
      quality = 95,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image upscaling and enhancement are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeUpscaleEnhance(
          resolved.source,
          {
            enhance,
            format,
            maxLongEdge,
            quality,
            scale,
            sharpen,
            targetHeight,
            targetWidth,
          },
          { chatId, documentId: validDocId, userId: session.user?.id as string }
        );

        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn("Non-fatal: Failed to persist upscale document:", dbErr);
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "upscale",
          params: {
            enhance,
            format,
            maxLongEdge,
            quality,
            scale,
            sharpen,
            targetHeight,
            targetWidth,
          },
          title: resolved.title,
        });

        const sizingLabel =
          targetWidth || targetHeight
            ? `${targetWidth ?? "auto"}×${targetHeight ?? "auto"} px`
            : maxLongEdge
              ? `max ${maxLongEdge}px`
              : `${scale}×`;

        return {
          id: validDocId,
          message: `Enlarged image ${sizingLabel} to ${result.width}×${result.height} px${sharpen || enhance ? " with enhancement" : ""}.`,
          pixelDimensions: `${result.width}x${result.height} px`,
          scale,
          sizeKb: Math.round(result.sizeBytes / 1024),
          toolMode: "upscale",
        };
      } catch (err: any) {
        console.error("Upscale tool execution error:", err);
        return { error: err.message || "Failed to upscale photo" };
      }
    },
    inputSchema: z.object({
      enhance: z.boolean().optional().default(false),
      format: z
        .enum(["jpeg", "png", "webp", "avif", "tiff"])
        .optional()
        .default("jpeg"),
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
        .describe(
          "Upscale multiplier (1-8). Ignored when a target size is set."
        ),
      sharpen: z.boolean().optional().default(true),
      targetHeight: z
        .number()
        .positive()
        .optional()
        .describe("Exact target height in px (overrides scale)."),
      targetWidth: z
        .number()
        .positive()
        .optional()
        .describe("Exact target width in px (overrides scale)."),
    }),
  });

export const imagePixelate = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Pixelate (mosaic) or blur an image to redact faces, license plates, or other private information.",
    execute: async ({
      id,
      imageUrl,
      blockSize = 12,
      mode = "mosaic",
      format = "png",
      quality = 95,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Image pixelation and redaction are reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executePixelate(
          resolved.source,
          { blockSize, format, mode, quality },
          { chatId, documentId: validDocId, userId: session.user?.id as string }
        );

        activeImageRegistry.setActiveImage({
          base64: result.base64,
          chatId,
          documentId: validDocId,
          title: resolved.title,
          userId: session.user?.id as string,
        });

        try {
          await persistAndSaveImageDocument({
            buffer: result.buffer ?? Buffer.from(result.base64, "base64"),
            chatId,
            documentId: validDocId,
            format: result.format,
            height: result.height,
            title: resolved.title,
            userId: session.user?.id as string,
            width: result.width,
          });
        } catch (dbErr) {
          console.warn(
            "Non-fatal: Failed to persist pixelate document:",
            dbErr
          );
        }

        emitImageArtifact(dataStream, {
          base64: result.base64,
          id: validDocId,
          mode: "pixelate",
          params: { blockSize, format, mode, quality },
          title: resolved.title,
        });

        return {
          blockSize,
          id: validDocId,
          message:
            mode === "blur"
              ? `Blurred image with a ${blockSize}px radius.`
              : `Pixelated image with ${blockSize}px blocks.`,
          mode,
          pixelDimensions: `${result.width}x${result.height} px`,
          sizeKb: Math.round(result.sizeBytes / 1024),
          toolMode: "pixelate",
        };
      } catch (err: any) {
        console.error("Pixelate tool execution error:", err);
        return { error: err.message || "Failed to pixelate photo" };
      }
    },
    inputSchema: z.object({
      blockSize: z.number().min(2).max(64).optional().default(12),
      format: z
        .enum(["jpeg", "png", "webp", "avif", "tiff"])
        .optional()
        .default("png"),
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
      mode: z.enum(["mosaic", "blur"]).optional().default("mosaic"),
      quality: z.number().min(1).max(100).optional().default(95),
    }),
  });

export const imageOcr = ({
  session,
  dataStream,
  chatId,
  messages,
  activeImage,
}: ImageToolsProps) =>
  tool({
    description:
      "Extract text from an image (OCR) using native multimodal vision. Returns the extracted text formatted as Markdown, including tables.",
    execute: async ({ id, imageUrl }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: OCR text extraction is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        let resolved: { source: string; documentId: string; title: string };
        try {
          resolved = await resolveImageSource(
            session,
            id ?? activeImage?.documentId,
            imageUrl,
            chatId,
            messages,
            activeImage?.versionIndex
          );
        } catch (err: any) {
          return { error: err.message };
        }

        const validDocId = isValidUUID(resolved.documentId)
          ? resolved.documentId
          : generateUUID();

        const result = await executeOcr(
          resolved.source,
          { format: "markdown" },
          { chatId, documentId: validDocId, userId: session.user?.id as string }
        );

        // Mount the workbench on the source image and stream the OCR text
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
          data: "ocr",
          transient: true,
          type: "data-imageToolMode",
        });
        dataStream.write({ data: null, transient: true, type: "data-clear" });
        dataStream.write({
          data: resolved.source,
          transient: true,
          type: "data-imageDelta",
        });
        dataStream.write({
          data: result.text,
          transient: true,
          type: "data-imageOcrText",
        });
        dataStream.write({ data: null, transient: true, type: "data-finish" });

        return {
          id: validDocId,
          message: `Extracted ${result.wordCount} word${result.wordCount === 1 ? "" : "s"} from the image.`,
          ocrText: result.text,
          toolMode: "ocr",
          wordCount: result.wordCount,
        };
      } catch (err: any) {
        console.error("OCR tool execution error:", err);
        return { error: err.message || "Failed to extract text from image" };
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
    }),
  });

/**
 * Combines several images into one.
 *
 * The three composite tools are deliberately separate rather than one tool with
 * a mode enum: the model picks the wrong mode far more often than it picks the
 * wrong tool, and a stitch is genuinely a different request from an overlay.
 */
export const imageStitch = ({ session, dataStream, chatId }: ImageToolsProps) =>
  tool({
    description:
      "Stitch several images into one long image, top to bottom or side by side. Use it for long screenshots, before/after comparisons, or combining scanned pages into one strip. The result is a new PNG image.",
    execute: async ({
      background,
      direction = "vertical",
      documentIds,
      gap = 0,
      title,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Stitching images is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        const outcome = await executeStitch({
          background,
          chatId,
          direction,
          documentIds,
          gap,
          title: title ?? "Stitched image",
          userId: session.user?.id as string,
        });

        emitImageArtifact(dataStream, {
          base64: outcome.result.base64,
          id: outcome.documentId,
          mode: "convert",
          title: title ?? "Stitched image",
        });

        return {
          documentId: outcome.documentId,
          message: `Stitched ${outcome.used} images into one ${outcome.result.width}×${outcome.result.height} image.`,
          pages: outcome.result.width,
        };
      } catch (err: any) {
        console.error("Stitch tool execution error:", err);
        return { error: err.message || "Failed to stitch the images" };
      }
    },
    inputSchema: z.object({
      background: z
        .string()
        .optional()
        .describe("Canvas colour as a hex value, e.g. '#ffffff'."),
      direction: z
        .enum(["vertical", "horizontal"])
        .optional()
        .default("vertical")
        .describe(
          "Vertical stacks the images top to bottom; horizontal puts them side by side."
        ),
      documentIds: z
        .array(z.string().min(1))
        .min(2)
        .max(60)
        .describe("Document UUIDs of the images to stitch, in order."),
      gap: z
        .number()
        .int()
        .min(0)
        .max(500)
        .optional()
        .default(0)
        .describe("Gap between the images, in pixels."),
      title: z.string().max(120).optional(),
    }),
  });

export const imageOverlay = ({
  session,
  dataStream,
  chatId,
}: ImageToolsProps) =>
  tool({
    description:
      "Place one image on top of another — a logo, a watermark, a cutout over a background. The overlay keeps its transparency and is scaled relative to the base image.",
    execute: async ({
      baseDocumentId,
      opacity = 1,
      overlayDocumentId,
      position = "bottom-right",
      scale = 0.4,
      title,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Overlaying images is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        const outcome = await executeOverlay({
          baseDocumentId,
          chatId,
          opacity,
          overlayDocumentId,
          position,
          scale,
          title: title ?? "Overlaid image",
          userId: session.user?.id as string,
        });

        emitImageArtifact(dataStream, {
          base64: outcome.result.base64,
          id: outcome.documentId,
          mode: "convert",
          title: title ?? "Overlaid image",
        });

        return {
          documentId: outcome.documentId,
          message: `Placed the overlay at the ${position} of the base image — now ${outcome.result.width}×${outcome.result.height} px.`,
        };
      } catch (err: any) {
        console.error("Overlay tool execution error:", err);
        return { error: err.message || "Failed to overlay the images" };
      }
    },
    inputSchema: z.object({
      baseDocumentId: z
        .string()
        .describe("Document UUID of the image to place the overlay on."),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(1)
        .describe("How strongly the overlay shows through, 0 to 1."),
      overlayDocumentId: z
        .string()
        .describe("Document UUID of the image placed on top."),
      position: z
        .enum([
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
          "center",
        ])
        .optional()
        .default("bottom-right"),
      scale: z
        .number()
        .min(0.05)
        .max(1)
        .optional()
        .default(0.4)
        .describe("Overlay size relative to the base image's width."),
      title: z.string().max(120).optional(),
    }),
  });

export const imageCollage = ({
  session,
  dataStream,
  chatId,
}: ImageToolsProps) =>
  tool({
    description:
      "Arrange several images into a single grid collage, with every cell the same size. Use it for a contact sheet, a photo grid, or a comparison board.",
    execute: async ({
      background,
      cellHeight = 400,
      columns,
      documentIds,
      gap = 12,
      title,
    }) => {
      try {
        if (checkIsGuest(session)) {
          return {
            error:
              "Account required: Building collages is reserved for registered accounts. Please sign in or create a free account to use this feature.",
            requiresAuth: true,
          };
        }

        const outcome = await executeCollage({
          background,
          cellHeight,
          chatId,
          columns,
          documentIds,
          gap,
          title: title ?? "Collage",
          userId: session.user?.id as string,
        });

        emitImageArtifact(dataStream, {
          base64: outcome.result.base64,
          id: outcome.documentId,
          mode: "convert",
          title: title ?? "Collage",
        });

        return {
          documentId: outcome.documentId,
          message: `Built a collage of ${outcome.used} images — ${outcome.result.width}×${outcome.result.height} px.`,
        };
      } catch (err: any) {
        console.error("Collage tool execution error:", err);
        return { error: err.message || "Failed to build the collage" };
      }
    },
    inputSchema: z.object({
      background: z
        .string()
        .optional()
        .describe("Canvas colour as a hex value. Defaults to white."),
      cellHeight: z
        .number()
        .int()
        .min(40)
        .max(2000)
        .optional()
        .default(400)
        .describe("Height of each cell in the grid, in pixels."),
      columns: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Number of columns. Defaults to a near-square grid."),
      documentIds: z
        .array(z.string().min(1))
        .min(2)
        .max(60)
        .describe("Document UUIDs of the images to place in the collage."),
      gap: z
        .number()
        .int()
        .min(0)
        .max(200)
        .optional()
        .default(12)
        .describe("Gap between the cells, in pixels."),
      title: z.string().max(120).optional(),
    }),
  });

/**
 * Pure preset lookup (no image work, no API route). Lets the model resolve loose
 * wording — "china visa photo", "green card", "2x2 inch" — into an exact preset
 * key plus geometry before calling imageResize.
 */
export const imageListPresets = () =>
  tool({
    description:
      "Look up official photo size presets (passport, visa, ID card, print) by country, document type, or loose keywords such as '2x2 inch', 'green card' or '4x6 print'. Returns the exact preset key, physical dimensions, DPI and resulting pixels. Call this BEFORE imageResize when the user names a document or country but you are unsure of the exact preset key.",
    execute: ({ query, limit = 5 }) => {
      const matches = findPresetsByQuery(query, limit);

      if (matches.length === 0) {
        return {
          message: `No preset matched "${query}". Ask the user for exact dimensions (width/height + unit, or pixels), or use the universal passport_photo preset for a generic 35×45 mm ID photo.`,
          presets: [],
        };
      }

      return {
        message: `Found ${matches.length} matching preset${matches.length === 1 ? "" : "s"}.`,
        presets: matches.map((preset) => ({
          dpi: preset.dpi,
          height: preset.height,
          key: preset.key,
          name: preset.displayName,
          pixelHeight: preset.resultPxHeight,
          pixelWidth: preset.resultPxWidth,
          region: preset.region,
          requirements: preset.requirements,
          unit: preset.unit,
          width: preset.width,
        })),
      };
    },
    inputSchema: z.object({
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Maximum number of presets to return (default 5)."),
      query: z
        .string()
        .min(1)
        .describe(
          "Country, document type, or loose keywords, e.g. 'china visa', '2x2 inch', 'pan card', 'green card', '4x6 print'."
        ),
    }),
  });
