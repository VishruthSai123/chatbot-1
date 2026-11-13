import { ipAddress } from "@vercel/functions";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { getEntitlement } from "@/lib/entitlements";
import { checkIpRateLimitFor } from "@/lib/ratelimit";
import { runAudioResolve } from "@/lib/tools/audio/handler";
import { runImageAction } from "@/lib/tools/image/handler";
import {
  runMediaSessionAction,
  runMediaSessions,
} from "@/lib/tools/media/handler";
import { runPdfAction } from "@/lib/tools/pdf/handler";
import {
  classifyToolAction,
  PlanFeatureError,
  reserveToolQuota,
  settleToolQuota,
} from "@/lib/tools/quota";
import { runSheetAction } from "@/lib/tools/sheet/handler";
import { type ActionReservation, releaseAction } from "@/lib/usage/actions";
import { toolsQuotaEnabled } from "@/lib/usage/config";
import { QuotaExceededError } from "@/lib/usage/ledger";

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

    const allowed = await checkIpRateLimitFor({
      ip: ipAddress(request),
      key: "tools",
      limit: 60,
    });

    if (!allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many tool requests." },
        { status: 429 }
      );
    }

    const { family } = await context.params;
    const body = await request.json();
    const quotaClass = classifyToolAction(family, body?.action);

    let reservation: ActionReservation | null = null;
    if (toolsQuotaEnabled()) {
      const plan = await getEntitlement(session.user.id);
      try {
        reservation = await reserveToolQuota({
          plan,
          quotaClass,
          userId: session.user.id,
        });
      } catch (error) {
        if (error instanceof PlanFeatureError) {
          return NextResponse.json(
            {
              error: "upgrade_required",
              feature: error.feature,
              message:
                "That tool is part of paid plans. Basic image and PDF edits stay free on your device.",
            },
            { status: 403 }
          );
        }
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

    let result: Response;
    try {
      result = await (async () => {
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
      })();
    } catch (error) {
      if (reservation) {
        await releaseAction(reservation).catch(() => undefined);
      }
      throw error;
    }

    if (result.status >= 400) {
      if (reservation) {
        await releaseAction(reservation).catch(() => undefined);
      }
    } else {
      await settleToolQuota({
        action: String(body?.action ?? "unknown"),
        family,
        quotaClass,
        reservation,
        userId: session.user.id,
      }).catch((error) => {
        console.error("Tool usage settlement failed:", error);
      });
    }

    return result;
  } catch (error: any) {
    console.error("Error executing tool action:", error);
    return NextResponse.json(
      { error: error.message || "Tool execution failed" },
      { status: 500 }
    );
  }
}
