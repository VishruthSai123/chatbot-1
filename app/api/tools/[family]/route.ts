import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { runImageAction } from "@/lib/tools/image/handler";
import { runPdfAction } from "@/lib/tools/pdf/handler";

export const maxDuration = 60;

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
