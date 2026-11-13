import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { getEntitlement } from "@/lib/entitlements";
import { downloadMedia } from "@/lib/media/download";
import { storeDownloadedMedia } from "@/lib/media/persist";
import { readMediaSessionForUrl } from "@/lib/media/session";
import {
  type ActionReservation,
  releaseAction,
  reserveAction,
  settleAction,
} from "@/lib/usage/actions";
import { downloadQuotaEnabled } from "@/lib/usage/config";
import { QuotaExceededError, recordUsage } from "@/lib/usage/ledger";
import { downloadCost } from "@/lib/usage/pricing";

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
  let reservation: ActionReservation | null = null;

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

    const plan = await getEntitlement(session.user.id);

    // Downloads are a paid feature, not a flag. Keeping this check outside the
    // quota switch is what makes the free plan honest while billing is pending.
    if (plan.downloadsPerMonth <= 0) {
      return NextResponse.json(
        {
          error: "upgrade_required",
          message:
            "Media downloads are part of paid plans. Local search and on-device tools stay free.",
        },
        { status: 403 }
      );
    }

    if (downloadQuotaEnabled()) {
      try {
        reservation = await reserveAction({
          kind: "downloads",
          limit: plan.downloadsPerMonth,
          subjectId: session.user.id,
        });
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return NextResponse.json(
            {
              error: "quota_exceeded",
              kind: error.details.kind,
              limit: error.details.limit,
              period: error.details.period,
              resetAt: error.details.resetAt,
            },
            { status: 429 }
          );
        }
        throw error;
      }
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

    if (reservation) {
      await settleAction({
        costUsd: downloadCost(stored.sizeBytes),
        eventKind: "download",
        metadata: { format },
        reservation,
      }).catch((error) => {
        console.error("Download usage settlement failed:", error);
      });
    } else {
      await recordUsage({
        bytesOut: stored.sizeBytes,
        costUsd: downloadCost(stored.sizeBytes),
        kind: "download",
        metadata: { format },
        userId: session.user.id,
      }).catch((error) => {
        console.error("Download usage recording failed:", error);
      });
    }

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
    if (reservation) {
      await releaseAction(reservation).catch(() => undefined);
    }
    console.error("Media download failed:", error);
    return NextResponse.json(
      { error: error?.message ?? "The download failed." },
      { status: 400 }
    );
  }
}
