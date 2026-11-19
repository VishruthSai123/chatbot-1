import { auth } from "@/app/(auth)/auth";
import {
  getDocumentsForUser,
  getRecentChatsByUserId,
  getRecentDocumentsForUser,
  searchChatsByUserId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const MAX_RECENT_LIMIT = 50;
const DEFAULT_RECENT_LIMIT = 30;
const MAX_SEARCH_LIMIT = 10;
const DOCUMENT_KINDS = [
  "audio",
  "code",
  "doc",
  "image",
  "notebook",
  "pdf",
  "sheet",
  "slides",
  "text",
] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number];

type LibrarySource = "chat" | "document";

type LibraryItem = {
  createdAt: string;
  href: string;
  id: string;
  kind: string;
  source: LibrarySource;
  title: string;
};

type Cursor = {
  createdAt: Date;
  id: string;
};

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function parseKind(value: string | null): DocumentKind | undefined {
  if (!value) {
    return;
  }
  return DOCUMENT_KINDS.find((kind) => kind === value);
}

function parseSource(value: string | null): LibrarySource | undefined {
  return value === "chat" || value === "document" ? value : undefined;
}

/**
 * Cursor format: `<createdAt epoch millis>_<id>`.
 *
 * The id is only read after the last underscore because ids never contain one,
 * while keeping the whole value opaque to the client.
 */
function parseCursor(value: string | null): Cursor | null {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf("_");
  if (separator <= 0) {
    return null;
  }
  const millis = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isFinite(millis) || millis <= 0 || !id) {
    return null;
  }
  return { createdAt: new Date(millis), id };
}

function encodeCursor(item: LibraryItem): string {
  return `${new Date(item.createdAt).getTime()}_${item.id}`;
}

function sortNewestFirst(items: LibraryItem[]): LibraryItem[] {
  return items.sort((left, right) => {
    const timeDelta =
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return right.id.localeCompare(left.id);
  });
}

function toDocumentItem(document: {
  createdAt: Date;
  id: string;
  kind: string | null;
  title: string;
}): LibraryItem {
  return {
    createdAt: document.createdAt.toISOString(),
    href: `/library?document=${document.id}`,
    id: document.id,
    kind: document.kind ?? "text",
    source: "document",
    title: document.title,
  };
}

function toChatItem(chat: {
  createdAt: Date;
  id: string;
  title: string;
}): LibraryItem {
  return {
    createdAt: chat.createdAt.toISOString(),
    href: `/chat/${chat.id}`,
    id: chat.id,
    kind: "chat",
    source: "chat",
    title: chat.title,
  };
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const recent = searchParams.get("recent") === "1";
  const kind = parseKind(searchParams.get("kind"));
  const source = parseSource(searchParams.get("source"));
  const cursor = parseCursor(searchParams.get("cursor"));

  if (recent && !query) {
    const limit = parseLimit(
      searchParams.get("limit"),
      DEFAULT_RECENT_LIMIT,
      MAX_RECENT_LIMIT
    );
    const perSourceLimit = limit + 1;
    const includeChats = source !== "document" && !kind;
    const includeDocuments = source !== "chat";

    const [documents, chats] = await Promise.all([
      includeDocuments
        ? getRecentDocumentsForUser({
            cursor,
            kind,
            limit: perSourceLimit,
            userId: session.user.id,
          })
        : Promise.resolve([]),
      includeChats
        ? getRecentChatsByUserId({
            cursor,
            id: session.user.id,
            limit: perSourceLimit,
          })
        : Promise.resolve([]),
    ]);

    const sorted = sortNewestFirst([
      ...documents.map(toDocumentItem),
      ...chats.map(toChatItem),
    ]);
    const page = sorted.slice(0, limit);
    const lastItem = page.at(-1);
    const nextCursor =
      sorted.length > limit && lastItem ? encodeCursor(lastItem) : null;

    return Response.json({ items: page, nextCursor });
  }

  if (!query) {
    return Response.json({ items: [], nextCursor: null });
  }

  const limit = parseLimit(searchParams.get("limit"), 6, MAX_SEARCH_LIMIT);
  const includeChats = source !== "document" && !kind;
  const includeDocuments = source !== "chat";

  const [documents, chats] = await Promise.all([
    includeDocuments
      ? getDocumentsForUser({
          kind,
          limit: 5,
          query,
          userId: session.user.id,
        })
      : Promise.resolve([]),
    includeChats
      ? searchChatsByUserId({
          id: session.user.id,
          limit: 4,
          query,
        })
      : Promise.resolve([]),
  ]);

  const items = sortNewestFirst([
    ...documents.map(toDocumentItem),
    ...chats.map(toChatItem),
  ]).slice(0, limit);

  return Response.json({ items, nextCursor: null });
}
