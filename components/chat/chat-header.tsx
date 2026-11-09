"use client";

import {
  PanelLeftIcon,
  PanelRightClose,
  PanelRightOpen,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useCallback, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useArtifact, useArtifactSelector } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { DownloadConversationButton } from "./download-conversation-button";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
  messages,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  messages: ChatMessage[];
}) {
  const { toggleSidebar } = useSidebar();
  const { isGuest } = useIsGuest();
  const pathname = usePathname();
  const { setArtifact } = useArtifact();
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const panelButtonRef = useRef<HTMLButtonElement>(null);

  const handleTogglePanel = useCallback(() => {
    if (isArtifactVisible) {
      setArtifact((current) => ({ ...current, isVisible: false }));
      return;
    }

    const rect = panelButtonRef.current?.getBoundingClientRect();

    setArtifact((current) => ({
      ...current,
      boundingBox: rect
        ? {
            height: rect.height,
            left: rect.left,
            top: rect.top,
            width: rect.width,
          }
        : current.boundingBox,
      isVisible: true,
    }));
  }, [isArtifactVisible, setArtifact]);

  /**
   * Always rendered, even with the sidebar collapsed.
   *
   * The header used to disappear in that state, which hid the guest notice and
   * the export button from anyone who had not opened the sidebar — the default
   * for a new visitor.
   */
  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        aria-label="Open the sidebar"
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={
                isArtifactVisible ? "Close workspace" : "Open workspace"
              }
              aria-pressed={isArtifactVisible}
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground",
                isArtifactVisible && "bg-muted/60 text-foreground"
              )}
              onClick={handleTogglePanel}
              ref={panelButtonRef}
              type="button"
            >
              {isArtifactVisible ? (
                <PanelRightClose className="size-3.5" />
              ) : (
                <PanelRightOpen className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isArtifactVisible ? "Close workspace" : "Open workspace"}
          </TooltipContent>
        </Tooltip>

        {/*
          A guest should know they are one before a tool refuses them, not
          after. This is the standing answer to "why did that not work".
        */}
        {isGuest ? (
          <Link
            className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            href={`/register?next=${encodeURIComponent(pathname || "/")}`}
          >
            <SparklesIcon className="size-3" />
            Guest · Sign up
          </Link>
        ) : null}

        <DownloadConversationButton messages={messages} />
      </div>
    </header>
  );
}

export const ChatHeader = memo(
  PureChatHeader,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.messages === nextProps.messages
);
