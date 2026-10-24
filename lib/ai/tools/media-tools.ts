import { tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { guestRegex } from "@/lib/constants";
import { downloadMedia as downloadMediaFile } from "@/lib/media/download";
import { storeDownloadedMedia } from "@/lib/media/persist";
import { readMediaSessionForUrl } from "@/lib/media/session";

type MediaToolsProps = {
  chatId?: string;
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Downloads media from a link.
 *
 * The heavy lifting is server-side; the MP3 conversion the user may ask for
 * afterwards happens in the browser, so this tool never needs FFmpeg.
 *
 * The user's own session for the platform is used when they have connected
 * one, which is what lets Instagram and Facebook be downloaded at all. The
 * cookies are never given to the model and never written to a log.
 */
export const downloadMedia = ({ chatId, session }: MediaToolsProps) =>
  tool({
    description:
      "Download a video or audio file from a link — a YouTube video, an Instagram or TikTok clip, a podcast episode, a Facebook video. Use it when the user pastes a link and asks to download it, save it, or get it as audio. Returns the file, ready to download.",
    execute: async ({ format = "video", quality, url }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to download media.",
          requiresAuth: true,
        };
      }

      try {
        const cookies = await readMediaSessionForUrl({
          url,
          userId: session.user.id,
        });

        const media = await downloadMediaFile({
          cookies,
          format: format === "audio" ? "audio" : "video",
          quality,
          url,
        });

        const stored = await storeDownloadedMedia({
          chatId,
          media,
          userId: session.user.id,
        });

        return {
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
          sourceUrl: media.sourceUrl,
          title: stored.title,
          url: stored.url,
        };
      } catch (error: any) {
        console.error("downloadMedia failed:", error);
        return {
          error:
            error?.message ??
            "That link could not be downloaded. It may be private, deleted, or unsupported.",
        };
      }
    },
    inputSchema: z.object({
      format: z
        .enum(["video", "audio"])
        .optional()
        .default("video")
        .describe(
          "'video' for the full video, 'audio' for the audio track only."
        ),
      quality: z
        .number()
        .int()
        .min(144)
        .max(4320)
        .optional()
        .describe(
          "Maximum video height in pixels — 720, 1080, 1440 or 2160. Ignored for audio."
        ),
      url: z
        .string()
        .min(4)
        .describe("The full link to the media, exactly as the user gave it."),
    }),
  });
