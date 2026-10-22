import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import { loadAudio } from "@/lib/tools/audio";

/**
 * Resolving an audio file for the browser.
 *
 * The studio needs two things it cannot compute itself: a URL it can play, and
 * a URL it can decode to draw a waveform. Both are the same signed link, so
 * this is one round trip rather than two.
 *
 * This is a `GET` on the shared `/api/tools/[family]` route rather than its own
 * route, because a route of its own would spend another of the twelve
 * serverless functions on what is really one more action.
 */
export async function runAudioResolve({
  documentId,
  session,
}: {
  documentId?: string;
  session: Session;
}): Promise<Response> {
  const isGuest =
    session.user.type === "guest" || guestRegex.test(session.user.email ?? "");

  if (isGuest) {
    return NextResponse.json(
      {
        error:
          "Sign in or create a free account to open audio files in the Audio Studio.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  if (!documentId) {
    return NextResponse.json({ error: "Missing documentId." }, { status: 400 });
  }

  const audio = await loadAudio({
    documentId,
    userId: session.user.id,
  });

  if (!audio) {
    return NextResponse.json(
      { error: "That audio file could not be opened." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    duration: audio.duration,
    filename: audio.filename,
    format: audio.mimeType,
    success: true,
    title: audio.title,
    transcript: audio.transcript,
    url: audio.url,
  });
}
