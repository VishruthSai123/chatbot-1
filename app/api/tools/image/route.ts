import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { getLatestDocumentByKind, saveDocument } from "@/lib/db/queries";
import { resolveDocumentImage } from "@/lib/image/resolve-source";
import { activeImageRegistry } from "@/lib/image/session-registry";
import { MAX_INLINE_BASE64_CHARS } from "@/lib/storage/limits";
import {
  executeCompress,
  executeConvert,
  executeCrop,
  executeGetMetadata,
  executeOcr,
  executePixelate,
  executeRemoveBg,
  executeResize,
  executeRotate,
  executeUpscaleEnhance,
} from "@/lib/tools/image";
import {
  compressSchema,
  convertSchema,
  cropSchema,
  ocrSchema,
  pixelateSchema,
  removeBgSchema,
  resizeSchema,
  rotateSchema,
  upscaleSchema,
} from "@/lib/tools/image/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isGuest =
      session.user.type === "guest" ||
      guestRegex.test(session.user.email ?? "");

    if (isGuest) {
      return NextResponse.json(
        {
          error:
            "Guest users must sign in or register to use image processing tools.",
          requiresAuth: true,
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, image, documentId, chatId, title, params, versionIndex } =
      body;

    // An inline base64 image is the old contract. It still works, but it crosses a
    // serverless request body and therefore caps out at 4.5 MB, so reject anything
    // that would be killed by the platform with an actionable message instead.
    if (typeof image === "string" && image.length > MAX_INLINE_BASE64_CHARS) {
      return NextResponse.json(
        {
          error:
            "This image is too large to send inline. Reopen it from the workbench so the edit can reference its document instead.",
          tooLarge: true,
        },
        { status: 413 }
      );
    }

    let imageSource: string | undefined;
    let resolvedDocumentId = documentId as string | undefined;
    let resolvedTitle = title as string | undefined;

    if (!image && documentId) {
      const resolved = await resolveDocumentImage({
        chatId,
        documentId,
        userId: session.user.id,
        versionIndex,
      });

      if (resolved) {
        imageSource = resolved.base64;
        resolvedDocumentId = resolved.documentId;
        resolvedTitle = resolved.title;
      }
    }

    if (!imageSource) {
      imageSource = image;
    }

    // Fall back to the active image for the user if still missing
    if (!imageSource) {
      const userCached = activeImageRegistry.getActiveImage({
        userId: session.user.id,
      });
      if (userCached?.base64) {
        imageSource = userCached.base64;
        resolvedDocumentId ??= userCached.documentId;
      }
    }

    // Last-resort durable fallback: newest persisted image Document for the user.
    // Keeps edits working across cold starts, reloads and expired signed URLs.
    if (!imageSource) {
      try {
        const latest = await getLatestDocumentByKind({
          kind: "image",
          userId: session.user.id,
        });
        if (latest?.content) {
          imageSource = latest.content;
          resolvedDocumentId ??= latest.id;
          resolvedTitle ??= latest.title;
          activeImageRegistry.setActiveImage({
            base64: latest.content,
            documentId: latest.id,
            title: latest.title,
            userId: session.user.id,
          });
        }
      } catch (err) {
        console.warn("Failed to resolve latest image document fallback:", err);
      }
    }

    if (!imageSource || typeof imageSource !== "string") {
      return NextResponse.json(
        { error: "Image data is required (dataUrl, URL, or base64)" },
        { status: 400 }
      );
    }

    const fallbackContext = {
      chatId,
      documentId: resolvedDocumentId,
      userId: session.user.id,
    };

    let result: any;

    switch (action) {
      case "resize":
      case "resize_physical": {
        const validated = resizeSchema.parse(params);
        result = await executeResize(imageSource, validated, fallbackContext);
        break;
      }
      case "remove_bg": {
        const validated = removeBgSchema.parse(params ?? {});
        result = await executeRemoveBg(imageSource, validated, fallbackContext);
        break;
      }
      case "crop": {
        const validated = cropSchema.parse(params);
        result = await executeCrop(imageSource, validated, fallbackContext);
        break;
      }
      case "rotate": {
        const validated = rotateSchema.parse(params ?? {});
        result = await executeRotate(imageSource, validated, fallbackContext);
        break;
      }
      case "compress": {
        const validated = compressSchema.parse(params ?? {});
        result = await executeCompress(imageSource, validated, fallbackContext);
        break;
      }
      case "convert": {
        const validated = convertSchema.parse(params);
        result = await executeConvert(imageSource, validated, fallbackContext);
        break;
      }
      case "upscale": {
        const validated = upscaleSchema.parse(params ?? {});
        result = await executeUpscaleEnhance(
          imageSource,
          validated,
          fallbackContext
        );
        break;
      }
      case "pixelate": {
        const validated = pixelateSchema.parse(params ?? {});
        result = await executePixelate(imageSource, validated, fallbackContext);
        break;
      }
      case "ocr": {
        const validated = ocrSchema.parse(params ?? {});
        const ocrResult = await executeOcr(
          imageSource,
          validated,
          fallbackContext
        );
        return NextResponse.json({ ocr: ocrResult, success: true });
      }
      case "get_metadata": {
        result = await executeGetMetadata(imageSource, fallbackContext);
        return NextResponse.json({ metadata: result, success: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown image action: ${action}` },
          { status: 400 }
        );
    }

    // Update session registry with latest version
    if (result?.base64) {
      activeImageRegistry.setActiveImage({
        base64: result.base64,
        documentId: resolvedDocumentId,
        title: resolvedTitle ?? "Image",
        userId: session.user.id,
      });
    }

    // Persist the result here rather than making the browser send the edited bytes
    // back up: the tool already holds them, and a request body is exactly what
    // cannot carry a full-resolution image. `persisted` tells the client its edit
    // is already durable so it does not re-upload the same bytes.
    let persisted = false;

    if (resolvedDocumentId && result?.base64) {
      try {
        await saveDocument({
          content: result.base64,
          id: resolvedDocumentId,
          kind: "image",
          title: resolvedTitle ?? "Image",
          userId: session.user.id,
        });
        persisted = true;
      } catch (err) {
        console.warn("Failed to persist document version:", err);
      }
    }

    return NextResponse.json({
      documentId: resolvedDocumentId,
      persisted,
      result,
      success: true,
    });
  } catch (error: any) {
    console.error("Error executing image tool:", error);
    return NextResponse.json(
      {
        error: error.message || "Image processing failed",
      },
      { status: 500 }
    );
  }
}
