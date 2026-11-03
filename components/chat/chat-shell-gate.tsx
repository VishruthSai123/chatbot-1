"use client";

import { usePathname } from "next/navigation";

import { ChatShell } from "./shell";

/**
 * Renders the chat only where there is a chat to render.
 *
 * The chat shell lives in the route group's layout, so every page under it gets
 * the composer and the conversation. The Library is a different surface, so the
 * shell steps aside for it rather than showing an empty chat behind the list.
 */
export function ChatShellGate() {
  const pathname = usePathname();

  if (pathname?.startsWith("/library")) {
    return null;
  }

  return <ChatShell />;
}
