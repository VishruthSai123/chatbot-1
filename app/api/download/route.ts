import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { downloadMedia } from "@/lib/media/download";
import { storeDownloadedMedia } from "@/lib/media/persist";
import { readMediaSessionForUrl } from "@/lib/media/session";

/**
 * The media downloader.
 *
 * Its own function, deliberately separate from `/api/tools/[family]`. The yt-dlp
 * binary is a 39 MB native executable, and putting it in the shared tools
 * function would slow down every tools request and push that function towards
 * the 250 MB ceiling for a feature most requests never use.
 *
 * The result is stored in the user's own bucket and referenced by a document, so
 * the download is a real file they can come back to — not a link that expires.
 */
export const maxDuration = 120;

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
          error: "Sign in or create a free account to download media.",
          requiresAuth: true,
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const format = body?.format === "audio" ? "audio" : "video";
    const quality =
      typeof body?.quality === "number" ? Math.min(4320, body.quality) : 1080;

    if (!url) {
      return NextResponse.json(
        { error: "A link is required." },
        { status: 400 }
      );
    }

    const media = await downloadMedia({
      cookies: await readMediaSessionForUrl({ url, userId: session.user.id }),
      format,
      quality,
      url,
    });

    const stored = await storeDownloadedMedia({
      chatId: typeof body?.chatId === "string" ? body.chatId : undefined,
      media,
      userId: session.user.id,
    });

    return NextResponse.json({
      companion: stored.companion
        ? {
            documentId: stored.companion.documentId,
            filename: stored.companion.filename,
            sizeBytes: stored.companion.sizeBytes,
            url: stored.companion.url,
          }
        : undefined,
      documentId: stored.documentId,
      duration: media.duration,
      filename: stored.filename,
      format,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
      success: true,
      title: stored.title,
      url: stored.url,
    });
  } catch (error: any) {
    console.error("Media download failed:", error);
    return NextResponse.json(
      { error: error?.message ?? "The download failed." },
      { status: 400 }
    );
  }
}
