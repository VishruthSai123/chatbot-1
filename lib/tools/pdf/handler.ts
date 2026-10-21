import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import { saveDocument } from "@/lib/db/queries";
import { encodePdfRef } from "@/lib/pdf/ref";
import {
  describePdfSource,
  executeArrange,
  executeExtractText,
  executeMerge,
  executePdfMetadata,
  executeRotatePdf,
  executeSplit,
  resolvePdfSource,
} from "@/lib/tools/pdf";
import {
  arrangeSchema,
  extractTextSchema,
  mergeSchema,
  rotateSchema,
  splitSchema,
} from "@/lib/tools/pdf/types";

/**
 * The PDF family's half of `/api/tools/[family]`.
 *
 * Unlike the image route, bytes are never inlined into the request or the
 * response. The client sends a document id and the server resolves the file from
 * storage, because a scanned PDF is routinely larger than the 4.5 MB body ceiling
 * in both directions.
 *
 * `sourceDocumentIds` exists for merge: it is the one operation whose input is
 * plural, and it cannot be expressed as "the document I am looking at".
 */
export async function runPdfAction({
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
          "Guest users must sign in or register to use PDF tools. Create a free account to merge, split and edit documents.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  const {
    action,
    chatId,
    content,
    documentId,
    params,
    sourceDocumentIds,
    title,
    versionIndex,
  } = body;

  const context = {
    chatId: chatId as string | undefined,
    content: content as string | undefined,
    documentId: documentId as string | undefined,
    userId: session.user.id,
  };

  const requireSource = async () => {
    const source = await resolvePdfSource({ ...context, versionIndex });
    return source;
  };

  switch (action) {
    /**
     * Turns a version reference into something the canvas can draw.
     *
     * The studio cannot read storage directly: the bucket is private and a signed
     * URL is the only way in. Signing here rather than in a dedicated route keeps
     * the family inside the one shared function.
     */
    case "resolve": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      return NextResponse.json({
        result: await describePdfSource(source),
        success: true,
      });
    }

    case "get_metadata": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      const metadata = await executePdfMetadata({ buffer: source.buffer });

      return NextResponse.json({ metadata, success: true });
    }

    case "extract_text": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      const validated = extractTextSchema.parse(params ?? {});
      const text = await executeExtractText({
        buffer: source.buffer,
        params: validated,
      });

      return NextResponse.json({ success: true, text });
    }

    case "merge": {
      const ids: string[] = Array.isArray(sourceDocumentIds)
        ? sourceDocumentIds
        : [];

      if (ids.length === 0) {
        return NextResponse.json(
          { error: "Choose at least one document to merge." },
          { status: 400 }
        );
      }

      const sources = await Promise.all(
        ids.map((id) => resolvePdfSource({ ...context, documentId: id }))
      );

      if (sources.some((source) => !source)) {
        return NextResponse.json(
          { error: "One of the selected documents could not be opened." },
          { status: 404 }
        );
      }

      const buffers: Buffer[] = sources.map(
        (source) => (source as NonNullable<typeof source>).buffer
      );

      mergeSchema.parse(params ?? {});
      const { result } = await executeMerge({ context, inputs: buffers });

      const mergedDocumentId = await persistVersion({
        pages: result.pages,
        storageKey: result.storageKey,
        title: title || "Merged document",
        userId: session.user.id,
      });

      return NextResponse.json({
        documentId: mergedDocumentId,
        persisted: Boolean(mergedDocumentId),
        result,
        success: true,
      });
    }

    case "split": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      const validated = splitSchema.parse(params ?? {});
      const { results } = await executeSplit({
        buffer: source.buffer,
        context,
        params: validated,
      });

      // The first part becomes the next version of this document; the rest are
      // separate files. Promoting part one keeps undo and version history working
      // for the common single-range case.
      const [first, ...rest] = results;
      const nextId = await persistVersion({
        documentId: source.documentId,
        pages: first.pages,
        storageKey: first.storageKey,
        title: title || source.title,
        userId: session.user.id,
      });

      return NextResponse.json({
        documentId: nextId,
        persisted: Boolean(nextId),
        result: first,
        results: rest,
        success: true,
      });
    }

    case "arrange": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      const validated = arrangeSchema.parse(params ?? {});
      const { result } = await executeArrange({
        buffer: source.buffer,
        context,
        params: validated,
      });

      const nextId = await persistVersion({
        documentId: source.documentId,
        pages: result.pages,
        storageKey: result.storageKey,
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

    case "rotate": {
      const source = await requireSource();

      if (!source) {
        return NextResponse.json(
          { error: "Could not open that document." },
          { status: 404 }
        );
      }

      const validated = rotateSchema.parse(params ?? {});
      const { result } = await executeRotatePdf({
        buffer: source.buffer,
        context,
        params: validated,
      });

      const nextId = await persistVersion({
        documentId: source.documentId,
        pages: result.pages,
        storageKey: result.storageKey,
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

    default:
      return NextResponse.json(
        { error: `Unknown PDF action: ${action}` },
        { status: 400 }
      );
  }
}

/**
 * Writes a new document version that points at the produced file.
 *
 * `Document.content` holds the `pdf-ref:` envelope, never the bytes. That keeps a
 * row small enough to fetch alongside the whole version list, which is what makes
 * undo and redo cheap for a 30 MB scan.
 */
async function persistVersion({
  documentId,
  pages,
  storageKey,
  title,
  userId,
}: {
  documentId?: string;
  pages: number;
  storageKey: string;
  title: string;
  userId: string;
}): Promise<string | undefined> {
  try {
    const saved = await saveDocument({
      content: encodePdfRef({ pages, storageKey }),
      id: documentId ?? crypto.randomUUID(),
      kind: "pdf",
      title,
      userId,
    });

    return saved?.[0]?.id ?? documentId;
  } catch (error) {
    // The bytes are stored and downloadable even if the row fails, so this must
    // not turn a successful edit into an error the user has to retry.
    console.warn("Non-fatal: failed to persist PDF version:", error);
  }
}
