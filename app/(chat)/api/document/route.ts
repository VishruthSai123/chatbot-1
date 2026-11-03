import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/chat/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  getDocumentsForUser,
  saveDocument,
  updateDocumentContent,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { deleteArtifact } from "@/lib/storage";

const documentSchema = z.object({
  content: z.string(),
  isManualEdit: z.boolean().optional(),
  kind: z.enum([
    "text",
    "code",
    "image",
    "sheet",
    "pdf",
    "notebook",
    "doc",
    "audio",
  ]),
  title: z.string(),
});

const KINDS = [
  "audio",
  "code",
  "doc",
  "image",
  "notebook",
  "pdf",
  "sheet",
  "text",
] as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  /**
   * Without an id this is the Library: a page of the user's documents, without
   * their bodies. It lives on this route rather than its own because a separate
   * function would spend one of the twelve the deployment has.
   */
  if (!id) {
    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:document").toResponse();
    }

    const rawKind = searchParams.get("kind");
    const kind = KINDS.find((value) => value === rawKind);
    const query = searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") ?? 60) || 60)
    );
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);

    const rows = await getDocumentsForUser({
      kind,
      // One extra row tells us whether there is another page, without a count
      // query over a table that can hold thousands of documents.
      limit: limit + 1,
      offset,
      query,
      userId: session.user.id,
    });

    return Response.json(
      {
        documents: rows.slice(0, limit),
        hasMore: rows.length > limit,
      },
      { status: 200 }
    );
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  const documents = await getDocumentsById({ id });

  const [document] = documents;

  if (!document) {
    return new ChatbotError("not_found:document").toResponse();
  }

  if (document.userId !== session.user.id) {
    return new ChatbotError("forbidden:document").toResponse();
  }

  return Response.json(documents, { status: 200 });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("not_found:document").toResponse();
  }

  let content: string;
  let title: string;
  let kind: ArtifactKind;
  let isManualEdit: boolean | undefined;

  try {
    ({ content, isManualEdit, kind, title } = documentSchema.parse(
      await request.json()
    ));
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Invalid request body."
    ).toResponse();
  }

  const documents = await getDocumentsById({ id });

  if (documents.length > 0) {
    const [doc] = documents;

    if (doc.userId !== session.user.id) {
      return new ChatbotError("forbidden:document").toResponse();
    }
  }

  if (isManualEdit && documents.length > 0) {
    const result = await updateDocumentContent({ content, id });
    return Response.json(result, { status: 200 });
  }

  const document = await saveDocument({
    content,
    id,
    kind,
    title,
    userId: session.user.id,
  });

  return Response.json(document, { status: 200 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const timestamp = searchParams.get("timestamp");

  if (!id) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  if (!timestamp) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter timestamp is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:document").toResponse();
  }

  const documents = await getDocumentsById({ id });

  const [firstVersion] = documents;

  if (firstVersion.userId !== session.user.id) {
    return new ChatbotError("forbidden:document").toResponse();
  }

  const parsedTimestamp = new Date(timestamp);

  if (Number.isNaN(parsedTimestamp.getTime())) {
    return new ChatbotError(
      "bad_request:api",
      "Invalid timestamp."
    ).toResponse();
  }

  const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
    id,
    timestamp: parsedTimestamp,
  });

  /**
   * Remove the files too.
   *
   * A document row is a descriptor; the bytes live in storage. Deleting only
   * the row would leave the file behind forever, invisible and still billed.
   * Every family's envelope carries a `storageKey`, so it is read from there.
   */
  await Promise.all(
    documents.map(async (version) => {
      const match = /"storageKey":"([^"]+)"/.exec(version.content ?? "");

      if (!match?.[1]?.startsWith(`${session.user.id}/`)) {
        return;
      }

      try {
        await deleteArtifact(match[1]);
      } catch (error) {
        // The row is already gone; a file that cannot be removed is a cleanup
        // problem, not a reason to fail the delete.
        console.warn("Could not remove the stored file:", error);
      }
    })
  );

  return Response.json(documentsDeleted, { status: 200 });
}
