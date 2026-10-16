import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/chat/artifact";
import {
  deleteAllChatsByUserId,
  deleteDocumentsByIdAfterTimestamp,
  getChatById,
  getChatsByUserId,
  getDocumentsById,
  getMessagesByChatId,
  getVotesByChatId,
  saveDocument,
  updateDocumentContent,
  voteMessage,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { convertToUIMessages } from "@/lib/utils";

const documentSchema = z.object({
  content: z.string(),
  isManualEdit: z.boolean().optional(),
  kind: z.enum(["text", "code", "image", "sheet"]),
  title: z.string(),
});

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

type RouteProps = {
  params: Promise<{ slug: string }>;
};

// ---------------------------------------------------------------------------
// GET Handlers
// ---------------------------------------------------------------------------

async function handleGetDocument(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter id is missing"
    ).toResponse();
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

async function handleGetHistory(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
    50
  );
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    return new ChatbotError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chats = await getChatsByUserId({
    endingBefore,
    id: session.user.id,
    limit,
    startingAfter,
  });

  return Response.json(chats);
}

async function handleGetMessages(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const [session, chat, messages] = await Promise.all([
    auth(),
    getChatById({ id: chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  if (!chat) {
    return Response.json({
      isReadonly: false,
      messages: [],
      userId: null,
      visibility: "private",
    });
  }

  if (
    chat.visibility === "private" &&
    (!session?.user || session.user.id !== chat.userId)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const isReadonly = !session?.user || session.user.id !== chat.userId;

  return Response.json({
    isReadonly,
    messages: convertToUIMessages(messages),
    userId: chat.userId,
    visibility: chat.visibility,
  });
}

async function handleGetVote(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter chatId is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function GET(request: NextRequest, props: RouteProps) {
  const { slug } = await props.params;

  switch (slug) {
    case "document":
      return handleGetDocument(request);
    case "history":
      return handleGetHistory(request);
    case "messages":
      return handleGetMessages(request);
    case "vote":
      return handleGetVote(request);
    default:
      return new Response("Not Found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// POST Handlers
// ---------------------------------------------------------------------------

async function handlePostDocument(request: Request) {
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

export async function POST(request: NextRequest, props: RouteProps) {
  const { slug } = await props.params;

  switch (slug) {
    case "document":
      return handlePostDocument(request);
    default:
      return new Response("Not Found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// PATCH Handlers
// ---------------------------------------------------------------------------

async function handlePatchVote(request: Request) {
  let chatId: string;
  let messageId: string;
  let type: "up" | "down";

  try {
    ({ chatId, messageId, type } = voteSchema.parse(await request.json()));
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Parameters chatId, messageId, and type are required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:vote").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  await voteMessage({
    chatId,
    messageId,
    type,
  });

  return new Response("Message voted", { status: 200 });
}

export async function PATCH(request: NextRequest, props: RouteProps) {
  const { slug } = await props.params;

  switch (slug) {
    case "vote":
      return handlePatchVote(request);
    default:
      return new Response("Not Found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// DELETE Handlers
// ---------------------------------------------------------------------------

async function handleDeleteDocument(request: Request) {
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
  const [document] = documents;

  if (document.userId !== session.user.id) {
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

  return Response.json(documentsDeleted, { status: 200 });
}

async function handleDeleteHistory() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const result = await deleteAllChatsByUserId({ userId: session.user.id });

  return Response.json(result, { status: 200 });
}

export async function DELETE(request: NextRequest, props: RouteProps) {
  const { slug } = await props.params;

  switch (slug) {
    case "document":
      return handleDeleteDocument(request);
    case "history":
      return handleDeleteHistory();
    default:
      return new Response("Not Found", { status: 404 });
  }
}
