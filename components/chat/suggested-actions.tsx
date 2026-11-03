"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  BookOpenIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  MicIcon,
  NotebookPenIcon,
  SearchIcon,
  TableIcon,
} from "lucide-react";
import { memo, useCallback } from "react";

import { capabilities, starterPrompts } from "@/lib/capabilities";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "../ai-elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

/**
 * The empty state.
 *
 * A blank chat used to offer four generic prompts, which told a user nothing
 * about what the app can do. This offers the *map* instead: the eight families
 * of tools, each a click away from examples. The four prompts underneath are
 * real tasks that work without an attachment, so the first click teaches
 * something.
 */

const ICONS = {
  audio: MicIcon,
  "book-open": BookOpenIcon,
  download: DownloadIcon,
  "file-text": FileTextIcon,
  image: ImageIcon,
  notebook: NotebookPenIcon,
  search: SearchIcon,
  table: TableIcon,
} as const;

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
  onShowCapabilities?: (familyId?: string) => void;
};

function PureSuggestedActions({
  chatId,
  sendMessage,
  onShowCapabilities,
}: SuggestedActionsProps) {
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        parts: [{ text: suggestion, type: "text" }],
        role: "user",
      });
    },
    [chatId, sendMessage]
  );

  return (
    <div className="flex w-full flex-col gap-3" data-testid="suggested-actions">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          What this can do
        </p>
        <button
          className="cursor-pointer text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
          onClick={() => onShowCapabilities?.()}
          type="button"
        >
          See all →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {capabilities.map((capability) => {
          const Icon = ICONS[capability.icon];

          return (
            <button
              className="group flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border border-border/50 bg-card/30 px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card/70"
              key={capability.id}
              onClick={() => onShowCapabilities?.(capability.id)}
              type="button"
            >
              <Icon className="size-4 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
              <span className="text-[12px] font-medium leading-tight text-foreground/90">
                {capability.name}
              </span>
              <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground/60">
                {capability.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex w-full gap-2 overflow-x-auto pb-1 no-scrollbar sm:grid sm:grid-cols-2 sm:overflow-visible">
        {starterPrompts.map((suggestion) => (
          <Suggestion
            className="h-auto min-w-[200px] shrink-0 whitespace-nowrap rounded-xl border border-border/40 bg-transparent px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground/70 transition-all duration-200 hover:bg-card/50 hover:text-foreground sm:min-w-0 sm:shrink sm:whitespace-normal"
            key={suggestion}
            onClick={handleSuggestionClick}
            suggestion={suggestion}
          >
            {suggestion}
          </Suggestion>
        ))}
      </div>
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.onShowCapabilities !== nextProps.onShowCapabilities) {
      return false;
    }

    return true;
  }
);
