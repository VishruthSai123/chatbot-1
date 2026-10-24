import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import {
  clearMediaSession,
  listMediaSessions,
  SESSION_PLATFORMS,
  storeMediaSession,
} from "@/lib/media/session";

/**
 * The user's own sessions for the media platforms.
 *
 * Instagram and Facebook serve most of their videos only to a signed-in
 * visitor, so a download from them needs the user's cookies. This is where
 * those cookies are connected and disconnected.
 *
 * It is a family on the shared `/api/tools/[family]` route rather than a route
 * of its own, because a route would spend another of the twelve serverless
 * functions on what is really one more action.
 */

/** Whether the session is allowed to manage media sessions. */
function isGuest(session: Session): boolean {
  return (
    session.user.type === "guest" || guestRegex.test(session.user.email ?? "")
  );
}

/**
 * Lists the platforms the user has connected, and what is available to
 * connect.
 */
export async function runMediaSessions({
  session,
}: {
  session: Session;
}): Promise<Response> {
  if (isGuest(session)) {
    return NextResponse.json(
      {
        error: "Sign in or create a free account to connect a media session.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  const connected = await listMediaSessions({ userId: session.user.id });

  return NextResponse.json({
    connected,
    platforms: SESSION_PLATFORMS,
    success: true,
  });
}

/**
 * Connects or disconnects a session.
 *
 * The cookies go straight to storage, encrypted. They are never echoed back
 * to the browser and never reach the model.
 */
export async function runMediaSessionAction({
  body,
  session,
}: {
  body: any;
  session: Session;
}): Promise<Response> {
  if (isGuest(session)) {
    return NextResponse.json(
      {
        error: "Sign in or create a free account to connect a media session.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  const action = typeof body?.action === "string" ? body.action : "";
  const platform =
    typeof body?.platform === "string"
      ? body.platform.trim().toLowerCase()
      : "";

  try {
    if (action === "connect") {
      const cookies = typeof body?.cookies === "string" ? body.cookies : "";

      const summary = await storeMediaSession({
        cookies,
        platform,
        userId: session.user.id,
      });

      return NextResponse.json({
        count: summary.count,
        domains: summary.domains,
        platform,
        success: true,
      });
    }

    if (action === "disconnect") {
      await clearMediaSession({ platform, userId: session.user.id });

      return NextResponse.json({ platform, success: true });
    }

    return NextResponse.json(
      { error: "Unknown media session action." },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "The media session could not be saved." },
      { status: 400 }
    );
  }
}
