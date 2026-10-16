import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { saveDocument } from "@/lib/db/queries";
import {
  executeCompress,
  executeConvert,
  executeCrop,
  executeGetMetadata,
  executeRemoveBg,
  executeResizePhysical,
  executeRotate,
} from "@/lib/tools/image";
import {
  compressSchema,
  convertSchema,
  cropSchema,
  removeBgSchema,
  resizePhysicalSchema,
  rotateSchema,
} from "@/lib/tools/image/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, image, documentId, title, params } = body;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Image data is required (dataUrl or base64)" },
        { status: 400 }
      );
    }

    let result: any;

    switch (action) {
      case "resize_physical": {
        const validated = resizePhysicalSchema.parse(params);
        result = await executeResizePhysical(image, validated);
        break;
      }
      case "remove_bg": {
        const validated = removeBgSchema.parse(params ?? {});
        result = await executeRemoveBg(image, validated);
        break;
      }
      case "crop": {
        const validated = cropSchema.parse(params);
        result = await executeCrop(image, validated);
        break;
      }
      case "rotate": {
        const validated = rotateSchema.parse(params ?? {});
        result = await executeRotate(image, validated);
        break;
      }
      case "compress": {
        const validated = compressSchema.parse(params ?? {});
        result = await executeCompress(image, validated);
        break;
      }
      case "convert": {
        const validated = convertSchema.parse(params);
        result = await executeConvert(image, validated);
        break;
      }
      case "get_metadata": {
        result = await executeGetMetadata(image);
        return NextResponse.json({ metadata: result, success: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown image action: ${action}` },
          { status: 400 }
        );
    }

    // If documentId is provided, save updated version to history
    if (documentId && result?.base64) {
      try {
        await saveDocument({
          content: result.base64,
          id: documentId,
          kind: "image",
          title: title ?? "Image",
          userId: session.user.id,
        });
      } catch (err) {
        console.warn("Failed to persist document version:", err);
      }
    }

    return NextResponse.json({
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
