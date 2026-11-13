import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { guestRegex } from "@/lib/constants";
import { saveDocument } from "@/lib/db/queries";
import { decodeImageCollection, isImageCollection } from "@/lib/image/ref";
import { encodePdfRef } from "@/lib/pdf/ref";
import { downloadArtifact } from "@/lib/storage";
import { parseImageInput } from "@/lib/tools/image";
import {
  describePdfSource,
  executeArrange,
  executeExtractText,
  executeImagesToPdf,
  executeMerge,
  executePdfMetadata,
  executeRotatePdf,
  executeSplit,
  persistPdfBytes,
  resolvePdfSource,
} from "@/lib/tools/pdf";
import {
  arrangeSchema,
  extractTextSchema,
  imagesToPdfSchema,
  mergeSchema,
  rotateSchema,
  splitSchema,
} from "@/lib/tools/pdf/types";

/**
 * Vercel rejects request bodies over 4.5 MB before the route runs. Keep a margin
 * for the JSON envelope and reject anything larger with an actionable message
 * instead of an opaque platform error.
 */
const MAX_CLIENT_PDF_BASE64_CHARS = 4_000_000;

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

  const normalizedAction = (action ?? "").toLowerCase().replace(/[-_]+/g, "_");

  const context = {
    chatId: chatId as string | undefined,
    content: content as string | undefined,
    documentId: documentId as string | undefined,
    userId: session.user.id,
  };

  const requireSource = async () =>
    await resolvePdfSource({ ...context, versionIndex });

  try {
    switch (normalizedAction) {
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

        const result = await describePdfSource(source);

        return NextResponse.json({
          result,
          success: true,
        });
      }

      case "get_metadata":
      case "metadata": {
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

      case "extract_text":
      case "extract":
      case "text": {
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

      /**
       * Stores parts the browser produced with `pdf-lib`.
       *
       * Splitting is pure page arithmetic plus re-serialisation, so it can run on
       * the client for free. The server still owns the write: it validates sizes,
       * mints signed URLs and promotes the first part to the next document
       * version, exactly like the server-side `split` action above.
       */
      case "persist_split": {
        const parts: Array<{
          base64?: string;
          filename?: string;
          pages?: number;
        }> = Array.isArray(params?.parts) ? params.parts : [];

        if (parts.length === 0) {
          return NextResponse.json(
            { error: "No browser-produced PDF parts were sent." },
            { status: 400 }
          );
        }

        const totalChars = parts.reduce(
          (sum, part) =>
            sum + (typeof part.base64 === "string" ? part.base64.length : 0),
          0
        );

        if (totalChars > MAX_CLIENT_PDF_BASE64_CHARS) {
          return NextResponse.json(
            { error: "Those parts are too large to upload in one request." },
            { status: 413 }
          );
        }

        const persisted: Awaited<ReturnType<typeof persistPdfBytes>>[] = [];
        for (const [index, part] of parts.entries()) {
          if (
            typeof part.base64 !== "string" ||
            !Number.isInteger(part.pages) ||
            Number(part.pages) < 1
          ) {
            continue;
          }

          const bytes = Buffer.from(part.base64, "base64");
          if (bytes.length === 0) {
            continue;
          }

          persisted.push(
            // biome-ignore lint/performance/noAwaitInLoops: uploads share one connection budget; serial keeps memory flat for large parts.
            await persistPdfBytes({
              bytes,
              chatId: context.chatId,
              filename:
                parts.length === 1
                  ? "split.pdf"
                  : `split-${index + 1}of${parts.length}.pdf`,
              pages: Number(part.pages),
              userId: session.user.id,
            })
          );
        }

        if (persisted.length === 0) {
          return NextResponse.json(
            { error: "None of the browser-produced parts were readable." },
            { status: 400 }
          );
        }

        const [first, ...rest] = persisted;
        const nextId = await persistVersion({
          documentId: context.documentId,
          pages: first.pages,
          storageKey: first.storageKey,
          title: title || "Document",
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

      case "rotate":
      case "rotate_pages": {
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

      case "images_to_pdf":
      case "image_to_pdf": {
        const ids: string[] = Array.isArray(sourceDocumentIds)
          ? sourceDocumentIds
          : [];

        if (ids.length === 0) {
          return NextResponse.json(
            { error: "Choose at least one image to convert to PDF." },
            { status: 400 }
          );
        }

        const validated = imagesToPdfSchema.parse(params ?? {});

        // Extract collection items if content has an image collection
        const collectionItems =
          content && isImageCollection(content)
            ? (decodeImageCollection(content)?.items ?? [])
            : [];

        const resolvedList = await Promise.all(
          ids.map(async (id) => {
            // 1. Check if id matches an item in the passed collection
            const matchedItem = collectionItems.find(
              (item) => item.documentId === id || item.storageKey === id
            );
            if (matchedItem?.storageKey) {
              try {
                const buffer = await downloadArtifact(matchedItem.storageKey);
                if (buffer?.length > 0) {
                  return {
                    buffer,
                    filename: matchedItem.filename || matchedItem.title,
                    mimeType: matchedItem.format || "image/png",
                  };
                }
              } catch (storageErr) {
                console.warn(
                  "Could not download collection item image:",
                  storageErr
                );
              }
            }

            // 2. Fall back to standard parseImageInput
            try {
              const parsed = await parseImageInput(id, {
                chatId: context.chatId,
                userId: session.user.id,
              });
              if (parsed?.buffer?.length > 0) {
                return parsed;
              }
            } catch {
              // ignore unresolvable image
            }
            return null;
          })
        );

        const imageInputs = resolvedList.filter(
          (img): img is NonNullable<typeof img> => Boolean(img)
        );

        if (imageInputs.length === 0) {
          return NextResponse.json(
            { error: "Could not read any of the specified images." },
            { status: 404 }
          );
        }

        const pdfTitle = title || validated.title || "Images Document";
        const { result } = await executeImagesToPdf({
          context,
          images: imageInputs,
          options: {
            layout: validated.layout,
            margin: validated.margin,
            title: pdfTitle,
          },
        });

        const nextId = await persistVersion({
          pages: result.pages,
          storageKey: result.storageKey,
          title: pdfTitle,
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
  } catch (error: any) {
    console.error("PDF action execution error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to process PDF action",
        success: false,
      },
      { status: 500 }
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
