"use client";

import { Clock, FileText, ListTree, Loader2, Type } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { decodeDocRef, flattenOutline } from "@/lib/doc/ref";
import { cn } from "@/lib/utils";

/*
 * The Document Studio.
 *
 * A document is opened, not edited. The panel's job is to make a long file
 * *legible*: a heading outline to jump by, reading statistics to judge the
 * commitment, and the text itself rendered as Markdown.
 *
 * The comparison view lives in the chat, as a tool card, because a diff is a
 * comparison of two things and that belongs where the two things are named.
 */

export interface DocumentStudioProps {
  content: string;
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  title: string;
  totalVersions?: number;
}

export const DocumentStudio = memo(function InnerDocumentStudio({
  content,
  title,
  totalVersions = 1,
}: DocumentStudioProps) {
  const { artifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  const doc = useMemo(() => decodeDocRef(content), [content]);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const headingCounts = useRef(new Map<string, number>());

  /**
   * Scrolls the document to a heading.
   *
   * The headings are rendered by the Markdown renderer, so the target is found
   * in the DOM rather than tracked by hand. When a document repeats a heading,
   * each click moves to the next occurrence instead of always jumping back to
   * the first one.
   */
  const jumpToHeading = useCallback((text: string) => {
    const root = contentRef.current;

    if (!root) {
      return;
    }

    const matches = Array.from(
      root.querySelectorAll("h1, h2, h3, h4, h5, h6")
    ).filter((node) => (node.textContent ?? "").trim() === text);

    if (matches.length === 0) {
      return;
    }

    const seen = headingCounts.current.get(text) ?? 0;
    const target = matches[Math.min(seen, matches.length - 1)];

    headingCounts.current.set(text, seen + 1);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveHeading(text);
  }, []);

  const outline = doc?.outline ?? [];
  const stats = doc?.stats;

  const headings = useMemo(() => flattenOutline(outline), [outline]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[220px] truncate text-xs font-semibold tracking-tight text-foreground md:text-sm">
              {doc?.title ?? artifact.title ?? title ?? "Document"}
            </span>
            <span className="truncate font-mono text-[10px] leading-none text-muted-foreground">
              {stats
                ? `${stats.words.toLocaleString()} words · ${stats.minutesToRead} min read`
                : "Document"}
              {totalVersions > 1 ? ` · v${totalVersions}` : ""}
            </span>
          </div>
        </div>

        {doc?.format ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            {doc.format}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Outline */}
        {headings.length > 0 ? (
          <aside className="hidden w-56 shrink-0 overflow-y-auto overscroll-contain border-r border-border/40 p-3 md:block">
            <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <ListTree className="size-3" />
              Outline
            </h2>
            <ul className="flex flex-col gap-0.5">
              {headings.map((heading) => (
                <li key={`${heading.level}-${heading.text}`}>
                  <button
                    className={cn(
                      "w-full cursor-pointer truncate rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-muted/60",
                      heading.depth === 0
                        ? "font-medium text-foreground/90"
                        : "text-muted-foreground",
                      activeHeading === heading.text &&
                        "bg-muted/60 text-foreground"
                    )}
                    onClick={() => jumpToHeading(heading.text)}
                    style={{ paddingLeft: `${6 + heading.depth * 10}px` }}
                    title={heading.text}
                    type="button"
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {/* Content */}
        <div
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-4"
          ref={contentRef}
        >
          {isGuest ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <FileText className="size-7 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">
                Document Studio
              </p>
              <p className="text-xs text-muted-foreground">
                Sign in to open documents and read them side by side.
              </p>
              <button
                className="mt-1 cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
                onClick={() => setShowAuthModal(true)}
                type="button"
              >
                Sign in
              </button>
            </div>
          ) : doc?.text ? (
            <article className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
              <MessageResponse>{doc.text}</MessageResponse>
            </article>
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Opening document…
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {stats ? (
        <div className="flex shrink-0 items-center gap-4 border-t border-border/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Type className="size-3" />
            {stats.words.toLocaleString()} words
          </span>
          <span className="flex items-center gap-1">
            <FileText className="size-3" />
            {stats.paragraphs.toLocaleString()} paragraphs
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {stats.minutesToRead} min read · {stats.minutesToSpeak} min spoken
          </span>
        </div>
      ) : null}

      <GuestAuthModal
        featureName="Document Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
