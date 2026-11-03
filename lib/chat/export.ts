/*
 * Turning a conversation into a file.
 *
 * Pure, so the format can be tested without a chat.
 *
 * The output is deliberately plain: a heading per message, the text as it was
 * written, a line for each attachment, and a line for each tool that ran. Tool
 * *outputs* are left out — they are often long, and a reader who wants them
 * can open the document they produced.
 */

import type { ChatMessage } from "@/lib/types";

/** The parts of a UI message this needs, and nothing else. */
type ExportablePart = {
  filename?: string;
  name?: string;
  text?: string;
  type: string;
};

/**
 * A conversation as Markdown.
 *
 * Empty assistant turns are skipped: a message that only called a tool would
 * otherwise become a heading with nothing under it.
 */
export function conversationToMarkdown(
  messages: ChatMessage[],
  title?: string
): string {
  const blocks: string[] = [];

  if (title?.trim()) {
    blocks.push(`# ${title.trim()}`);
  }

  for (const message of messages) {
    const parts = (message.parts ?? []) as ExportablePart[];
    const lines: string[] = [];

    for (const part of parts) {
      if (part.type === "text" && part.text?.trim()) {
        lines.push(part.text.trim());
        continue;
      }

      if (part.type === "file") {
        const name = part.filename ?? part.name ?? "attachment";
        lines.push(`_Attachment: ${name}_`);
        continue;
      }

      if (part.type.startsWith("tool-")) {
        const name = part.type.replace(/^tool-/, "");
        lines.push(`> Used \`${name}\``);
      }
    }

    if (lines.length === 0) {
      continue;
    }

    const heading = message.role === "user" ? "You" : "Assistant";

    blocks.push(`## ${heading}\n\n${lines.join("\n\n")}`);
  }

  return `${blocks.join("\n\n")}\n`;
}

/** A file name that is safe on every platform. */
export function conversationFilename(title: string | undefined): string {
  const base = (title ?? "conversation")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 60);

  return `${base || "conversation"}.md`;
}
