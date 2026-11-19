import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

type MessagePart = {
  text?: string;
  type?: string;
};

function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return (parts as MessagePart[])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function markdownForChat({
  messages,
  title,
}: {
  messages: { parts: unknown; role: string }[];
  title: string;
}): string {
  const lines = [`# ${title.trim() || "Untitled chat"}`, ""];

  for (const message of messages) {
    const text = messageText(message.parts);
    if (!text) {
      continue;
    }
    lines.push(message.role === "user" ? "## You" : "## Spire");
    lines.push("");
    lines.push(text);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Markdown export used by the native Library's "Export chat" action. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const messages = await getMessagesByChatId({ id });
  const markdown = markdownForChat({ messages, title: chat.title });
  const filename = `spire-chat-${id}.md`;

  return new Response(markdown, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
