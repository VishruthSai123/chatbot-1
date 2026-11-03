import { expect, test } from "@playwright/test";

import {
  conversationFilename,
  conversationToMarkdown,
} from "../../lib/chat/export";
import type { ChatMessage } from "../../lib/types";

function message(role: "assistant" | "user", parts: unknown[]): ChatMessage {
  return { id: `${role}-1`, parts, role } as unknown as ChatMessage;
}

test.describe("exporting a conversation", () => {
  test("writes a heading per message and the text under it", () => {
    const markdown = conversationToMarkdown([
      message("user", [{ text: "Merge these PDFs", type: "text" }]),
      message("assistant", [
        { text: "Merged them into one file.", type: "text" },
      ]),
    ]);

    expect(markdown).toContain("## You");
    expect(markdown).toContain("Merge these PDFs");
    expect(markdown).toContain("## Assistant");
    expect(markdown).toContain("Merged them into one file.");
  });

  test("includes the title when there is one", () => {
    const markdown = conversationToMarkdown(
      [message("user", [{ text: "Hi", type: "text" }])],
      "Quarterly review"
    );

    expect(markdown.startsWith("# Quarterly review")).toBe(true);
  });

  test("names attachments instead of dropping them", () => {
    const markdown = conversationToMarkdown([
      message("user", [
        { filename: "report.pdf", type: "file" },
        { text: "Summarise this", type: "text" },
      ]),
    ]);

    expect(markdown).toContain("_Attachment: report.pdf_");
  });

  test("notes which tools ran", () => {
    const markdown = conversationToMarkdown([
      message("assistant", [{ type: "tool-imageRemoveBg" }]),
    ]);

    expect(markdown).toContain("> Used `imageRemoveBg`");
  });

  test("skips a turn with nothing in it", () => {
    const markdown = conversationToMarkdown([
      message("user", [{ text: "Hello", type: "text" }]),
      message("assistant", []),
    ]);

    expect(markdown.match(/## /g)).toHaveLength(1);
  });

  test("an empty conversation is an empty document", () => {
    expect(conversationToMarkdown([])).toBe("\n");
  });
});

test.describe("naming the exported file", () => {
  test("keeps a readable title", () => {
    expect(conversationFilename("Quarterly review")).toBe(
      "Quarterly-review.md"
    );
  });

  test("strips characters a file system would object to", () => {
    expect(conversationFilename('bad/name: "here"')).toBe("badname-here.md");
  });

  test("falls back when there is no title", () => {
    expect(conversationFilename(undefined)).toBe("conversation.md");
    expect(conversationFilename("   ")).toBe("conversation.md");
  });
});
