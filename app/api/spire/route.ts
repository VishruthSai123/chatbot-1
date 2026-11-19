import { auth } from "@/app/(auth)/auth";
import { getDocumentsForUser, searchChatsByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const limit = Math.min(
    10,
    Math.max(1, Number(searchParams.get("limit") ?? 6) || 6)
  );

  if (!query) {
    return Response.json({ items: [] });
  }

  const [documents, chats] = await Promise.all([
    getDocumentsForUser({
      limit: 5,
      query,
      userId: session.user.id,
    }),
    searchChatsByUserId({
      id: session.user.id,
      limit: 4,
      query,
    }),
  ]);

  const items = [
    ...documents.map((document) => ({
      createdAt: document.createdAt.toISOString(),
      href: `/library?document=${document.id}`,
      id: document.id,
      kind: document.kind ?? "text",
      source: "document" as const,
      title: document.title,
    })),
    ...chats.map((chat) => ({
      createdAt: chat.createdAt.toISOString(),
      href: `/chat/${chat.id}`,
      id: chat.id,
      kind: "chat",
      source: "chat" as const,
      title: chat.title,
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, limit);

  return Response.json({ items });
}
