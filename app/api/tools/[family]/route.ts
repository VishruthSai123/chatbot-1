import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { runAudioResolve } from "@/lib/tools/audio/handler";
import { runImageAction } from "@/lib/tools/image/handler";
import {
  runMediaSessionAction,
  runMediaSessions,
} from "@/lib/tools/media/handler";
import { runPdfAction } from "@/lib/tools/pdf/handler";
import { runSheetAction } from "@/lib/tools/sheet/handler";

export const maxDuration = 60;

/**
 * Resolves a file for the browser.
 *
 * The studios need a URL they can play or decode — a signed link to the
 * original in storage. It is a `GET` on the same shared route as the actions,
 * because a route of its own would spend another of the twelve serverless
 * functions on what is really one more action.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ family: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { family } = await context.params;
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId") ?? undefined;

    switch (family) {
      case "audio":
        return await runAudioResolve({ documentId, session });
      case "media":
        return await runMediaSessions({ session });
      default:
        return NextResponse.json(
          { error: `Unknown tool family: ${family}` },
          { status: 404 }
        );
    }
  } catch (error: any) {
    console.error("Error resolving tool resource:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resolve the resource" },
      { status: 500 }
    );
  }
}

/**
 * One function serves every tool family.
 *
 * Vercel Hobby allows twelve serverless functions, and a route per family (image,
 * PDF, sheets, documents, media) would spend that budget on routing alone. The
 * family is a path segment instead, so adding one costs no extra function — only
 * a branch in the dispatch below.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ family: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { family } = await context.params;
    const body = await request.json();

    switch (family) {
      case "image":
        return await runImageAction({ body, session });
      case "pdf":
        return await runPdfAction({ body, session });
      case "sheet":
        return await runSheetAction({ body, session });
      case "media":
        return await runMediaSessionAction({ body, session });
      default:
        return NextResponse.json(
          { error: `Unknown tool family: ${family}` },
          { status: 404 }
        );
    }
  } catch (error: any) {
    console.error("Error executing tool action:", error);
    return NextResponse.json(
      { error: error.message || "Tool execution failed" },
      { status: 500 }
    );
  }
}
