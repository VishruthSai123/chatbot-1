import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import { writeSheetFile } from "@/lib/sheet/native";
import {
  applyDedupe,
  applyFilterSort,
  applyStats,
  describeSheetSource,
  executeConvert,
  persistSheetBytes,
  persistSheetVersion,
  readSheetRows,
  resolveSheetSource,
} from "@/lib/tools/sheet";
import {
  convertSchema,
  dedupeSchema,
  filterSortSchema,
  rowsSchema,
  statsSchema,
} from "@/lib/tools/sheet/types";

/**
 * The data family's half of `/api/tools/[family]`.
 *
 * Like the PDF family, bytes never travel in the request or the response: the
 * client sends a document id and the server resolves the file from storage. A
 * 50,000-row CSV is several megabytes, well past the platform's body ceiling.
 */
export async function runSheetAction({
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
          "Guest users must sign in or register to use data tools. Create a free account to analyse, convert and clean spreadsheets.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  const { action, chatId, documentId, params, title, versionIndex } = body;

  const context = {
    chatId: chatId as string | undefined,
    documentId: documentId as string | undefined,
    userId: session.user.id,
  };

  const source = await resolveSheetSource({ ...context, versionIndex });

  if (!source) {
    return NextResponse.json(
      { error: "Could not open that spreadsheet." },
      { status: 404 }
    );
  }

  switch (action) {
    /** Metadata plus the first rows, so the studio can lay out its grid. */
    case "resolve": {
      return NextResponse.json({
        result: await describeSheetSource(
          source,
          params?.sheetName as string | undefined
        ),
        success: true,
      });
    }

    /** A window of rows for the virtualised grid. */
    case "rows": {
      const validated = rowsSchema.parse(params ?? {});

      return NextResponse.json({
        result: readSheetRows(source, validated),
        success: true,
      });
    }

    /** Summary statistics. Read-only: it does not produce a new version. */
    case "stats": {
      const validated = statsSchema.parse(params ?? {});

      return NextResponse.json({
        stats: applyStats(
          source,
          validated,
          params?.sheetName as string | undefined
        ),
        success: true,
      });
    }

    case "filter_sort": {
      const validated = filterSortSchema.parse(params ?? {});
      const applied = applyFilterSort(source.sheets, validated);
      // The source format is preserved: editing a TSV file should not silently
      // turn it into a CSV.
      const bytes = await writeSheetFile(applied.sheets, source.format);
      const payload = await persistSheetBytes({
        bytes,
        chatId: context.chatId,
        filename: source.filename,
        format: source.format,
        sheets: applied.sheets,
        userId: session.user.id,
      });
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload,
        title: title || source.title,
        userId: session.user.id,
      });

      return NextResponse.json({
        affected: { after: applied.after, before: applied.before },
        documentId: nextId,
        persisted: Boolean(nextId),
        result: payload,
        success: true,
      });
    }

    case "dedupe": {
      const validated = dedupeSchema.parse(params ?? {});
      const applied = applyDedupe(source.sheets, validated);
      const bytes = await writeSheetFile(applied.sheets, source.format);
      const payload = await persistSheetBytes({
        bytes,
        chatId: context.chatId,
        filename: source.filename,
        format: source.format,
        sheets: applied.sheets,
        userId: session.user.id,
      });
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload,
        title: title || source.title,
        userId: session.user.id,
      });

      return NextResponse.json({
        affected: {
          after: applied.after,
          before: applied.before,
          removed: applied.removed,
        },
        documentId: nextId,
        persisted: Boolean(nextId),
        result: payload,
        success: true,
      });
    }

    case "convert": {
      const validated = convertSchema.parse(params ?? {});
      const { result } = await executeConvert({
        context,
        params: validated,
        source,
      });
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload: result,
        title: title || source.title,
        userId: session.user.id,
      });

      return NextResponse.json({
        documentId: nextId,
        persisted: Boolean(nextId),
        result,
        success: true,
      });
    }

    /**
     * Exports the current sheet in another format *without* creating a version.
     *
     * An export is a read: the user wants a copy in a different format, not a new
     * entry in the document's history. It does leave a file in storage, which is
     * the price of serving a download that expires.
     */
    case "export": {
      const validated = convertSchema.parse(params ?? {});
      const { result } = await executeConvert({
        context,
        params: validated,
        source,
      });

      return NextResponse.json({ result, success: true });
    }

    default:
      return NextResponse.json(
        { error: `Unknown sheet action: ${action}` },
        { status: 400 }
      );
  }
}
