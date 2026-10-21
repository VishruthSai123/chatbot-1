import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import { getLatestDocumentByKind, saveDocument } from "@/lib/db/queries";
import { persistImageBytes } from "@/lib/image/persist";
import { encodeImageRef } from "@/lib/image/ref";
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

/**
 * The image family's half of `/api/tools/[family]`.
 *
 * Split out of the route file so a second family can share the same serverless
 * function: Vercel Hobby allows twelve, and one route per family would spend that
 * budget on routing rather than work.
 *
 * Everything here is called by the workbench inspectors, never by the model — the
 * chat tools call the `execute*` functions in-process. That is why the request
 * carries a document id and a version index rather than the pixels themselves.
 */
export async function runImageAction({
  body,
  session,
}: {
  body: any;
  session: Session;
}): Promise<Response> {
  const isGuest =
    session.user.type === "guest" || guestRegex.test(session.user.email ?? "");

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

  const {
    action,
    image,
    documentId,
    chatId,
    title,
    params,
    versionIndex,
    flattenAlpha,
  } = body;

  // Set only after the studio's confirmation dialog. Every other caller keeps
  // transparency: a JPEG output from a transparent source would put the removed
  // background back (the colour channels still hold those pixels).
  const executionOptions = { flattenAlpha: flattenAlpha === true };

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
    case "resolve": {
      if (!resolvedDocumentId) {
        return NextResponse.json(
          { error: "Missing documentId to resolve." },
          { status: 400 }
        );
      }
      const resolved = await resolveDocumentImage({
        chatId,
        documentId: resolvedDocumentId,
        userId: session.user.id,
        versionIndex,
      });
      if (!resolved) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }
      return NextResponse.json({
        result: {
          documentId: resolved.documentId,
          format: resolved.format,
          height: resolved.height,
          sizeBytes: resolved.sizeBytes,
          storageKey: resolved.storageKey,
          thumbUrl: resolved.thumbUrl,
          title: resolved.title,
          url:
            resolved.url ||
            `data:image/${resolved.format || "png"};base64,${resolved.base64}`,
          width: resolved.width,
        },
        success: true,
      });
    }
    case "resize":
    case "resize_physical": {
      const validated = resizeSchema.parse(params);
      result = await executeResize(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "remove_bg": {
      const validated = removeBgSchema.parse(params ?? {});
      result = await executeRemoveBg(imageSource, validated, fallbackContext);
      break;
    }
    case "crop": {
      const validated = cropSchema.parse(params);
      result = await executeCrop(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "rotate": {
      const validated = rotateSchema.parse(params ?? {});
      result = await executeRotate(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "compress": {
      const validated = compressSchema.parse(params ?? {});
      result = await executeCompress(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "convert": {
      const validated = convertSchema.parse(params);
      result = await executeConvert(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "upscale": {
      const validated = upscaleSchema.parse(params ?? {});
      result = await executeUpscaleEnhance(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
      break;
    }
    case "pixelate": {
      const validated = pixelateSchema.parse(params ?? {});
      result = await executePixelate(
        imageSource,
        validated,
        fallbackContext,
        executionOptions
      );
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

  if (resolvedDocumentId && (result?.buffer || result?.base64)) {
    const buffer = result.buffer ?? Buffer.from(result.base64, "base64");
    try {
      const persistedRef = await persistImageBytes({
        bytes: buffer,
        chatId,
        filename: resolvedTitle
          ? `${resolvedTitle}.${result.format || "png"}`
          : undefined,
        format: result.format,
        height: result.height,
        userId: session.user.id,
        width: result.width,
      });

      result.storageKey = persistedRef.storageKey;
      result.url = persistedRef.url;
      result.thumbUrl = persistedRef.thumbUrl;

      await saveDocument({
        content: encodeImageRef(persistedRef),
        id: resolvedDocumentId,
        kind: "image",
        title: resolvedTitle ?? "Image",
        userId: session.user.id,
      });
      persisted = true;
    } catch (err) {
      console.warn(
        "Storage upload failed, falling back to database base64:",
        err
      );
      try {
        await saveDocument({
          content: result.base64,
          id: resolvedDocumentId,
          kind: "image",
          title: resolvedTitle ?? "Image",
          userId: session.user.id,
        });
        persisted = true;
      } catch (dbErr) {
        console.warn("Failed to persist document version to DB:", dbErr);
      }
    }
  }

  // Tell the client when the encoder changed its mind. The studio keeps a
  // cutout transparent by writing PNG instead of JPEG, and it says so in the
  // result so the toast and the download can be accurate about it.
  const requestedFormat =
    typeof params?.targetFormat === "string"
      ? params.targetFormat
      : typeof params?.format === "string"
        ? params.format
        : undefined;
  const transparencyPreserved = Boolean(
    requestedFormat && result?.format && result.format !== requestedFormat
  );

  return NextResponse.json({
    documentId: resolvedDocumentId,
    persisted,
    result,
    success: true,
    transparencyPreserved,
  });
}
