"use client";

import { DownloadIcon } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  conversationFilename,
  conversationToMarkdown,
} from "@/lib/chat/export";
import type { ChatMessage } from "@/lib/types";

/**
 * Saves the conversation as Markdown.
 *
 * A chat that only exists inside one app is a chat you cannot keep. The file is
 * built in the browser from the messages already on screen, so nothing is
 * uploaded and no endpoint is needed.
 */
export function DownloadConversationButton({
  messages,
  title,
}: {
  messages: ChatMessage[];
  title?: string;
}) {
  const handleDownload = useCallback(() => {
    if (messages.length === 0) {
      toast.error("There is nothing to save yet.");
      return;
    }

    const markdown = conversationToMarkdown(messages, title);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.download = conversationFilename(title);
    link.href = url;
    link.click();

    // The object URL is released once the browser has taken the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [messages, title]);

  return (
    <Button
      aria-label="Download this conversation as Markdown"
      className="h-8 gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground"
      onClick={handleDownload}
      size="sm"
      variant="ghost"
    >
      <DownloadIcon className="size-3.5" />
      <span className="hidden sm:inline">Export</span>
    </Button>
  );
}
