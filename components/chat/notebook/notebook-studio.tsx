"use client";

import {
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Send,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import {
  decodeNotebookRef,
  type NotebookRef,
  type NotebookSource,
} from "@/lib/notebook/ref";
import { cn } from "@/lib/utils";

/**
 * The Notebook studio.
 *
 * A notebook is a set of sources and a grounded conversation over them. The
 * conversation itself happens in the chat — the model calls `notebookAsk` and
 * `notebookGrade`, so the answer and the grading are ordinary chat turns with
 * citations — and this panel is the *state* of the notebook: what is in it, what
 * has been generated from it, and the way in.
 */

/** The icon and label for a source kind. */
function sourcePresentation(source: NotebookSource) {
  if (source.kind === "url") {
    return { Icon: Globe, kind: "Web" };
  }

  const mediaType = source.mediaType ?? "";

  if (mediaType.startsWith("image/")) {
    return { Icon: ImageIcon, kind: "Image" };
  }

  if (
    mediaType.includes("spreadsheet") ||
    mediaType === "text/csv" ||
    source.title.toLowerCase().endsWith(".csv") ||
    source.title.toLowerCase().endsWith(".xlsx")
  ) {
    return { Icon: FileSpreadsheet, kind: "Data" };
  }

  return { Icon: FileText, kind: "Document" };
}

export interface NotebookStudioProps {
  content: string;
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  onSaveContent?: (
    newContent: string,
    debounce: boolean,
    options?: { persisted?: boolean }
  ) => void;
  title: string;
  totalVersions?: number;
}

export const NotebookStudio = memo(function InnerNotebookStudio({
  content,
  title,
  totalVersions = 1,
}: NotebookStudioProps) {
  const { artifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const { sendMessage } = useActiveChat();
  const [question, setQuestion] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);

  const notebook: NotebookRef | null = useMemo(
    () => decodeNotebookRef(content),
    [content]
  );

  const sources = notebook?.sources ?? [];
  const deliverable = notebook?.deliverable;
  const quiz = notebook?.quiz;

  const handleAsk = useCallback(() => {
    const asked = question.trim();

    if (!asked) {
      return;
    }

    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    sendMessage({
      parts: [
        {
          text: `Using the notebook "${notebook?.title ?? title}", ${asked}`,
          type: "text",
        },
      ],
      role: "user",
    });

    setQuestion("");
  }, [isGuest, notebook?.title, question, sendMessage, title]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[220px] truncate text-xs font-semibold tracking-tight text-foreground md:text-sm">
              {notebook?.title ?? artifact.title ?? title ?? "Notebook"}
            </span>
            <span className="font-mono text-[10px] leading-none text-muted-foreground">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
              {totalVersions > 1 ? ` · v${totalVersions}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Ask */}
      <div className="shrink-0 border-b border-border/40 p-3">
        <div className="flex items-center gap-2">
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40"
            disabled={sources.length === 0}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAsk();
              }
            }}
            placeholder={
              sources.length === 0
                ? "Add a source to start asking…"
                : "Ask this notebook a question…"
            }
            type="text"
            value={question}
          />
          <button
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
            disabled={!question.trim() || sources.length === 0}
            onClick={handleAsk}
            type="button"
          >
            <Send className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {/* Sources */}
        <section>
          <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Sources
          </h2>

          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
              <Paperclip className="mx-auto size-5 text-muted-foreground/50" />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                No sources yet. Attach files or give a URL and ask for a
                notebook.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {sources.map((source) => {
                const { Icon, kind } = sourcePresentation(source);

                return (
                  <li
                    className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5"
                    key={
                      source.documentId ??
                      source.url ??
                      `${source.kind}:${source.title}`
                    }
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">
                      {source.title}
                    </span>
                    {source.readable === false ? (
                      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-600 dark:text-amber-400">
                        unreadable
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">
                        {kind}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quiz */}
        {quiz && quiz.questions.length > 0 ? (
          <section className="mt-4">
            <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Quiz · {quiz.questions.length} questions
            </h2>
            <ol className="flex flex-col gap-2">
              {quiz.questions.map((questionItem, index) => (
                <li
                  className="rounded-lg border border-border/50 bg-muted/20 p-2.5"
                  key={questionItem.id}
                >
                  <p className="text-[12px] font-medium leading-relaxed text-foreground/90">
                    {index + 1}. {questionItem.question}
                  </p>
                  {questionItem.options ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {questionItem.options.map((option, optionIndex) => (
                        <li
                          className="font-mono text-[10px] text-muted-foreground"
                          key={option}
                        >
                          {String.fromCharCode(65 + optionIndex)}. {option}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">
              Answer in the chat — each answer is marked against the source it
              came from.
            </p>
          </section>
        ) : null}

        {/* Deliverable */}
        {deliverable ? (
          <section className="mt-4">
            <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {deliverable.title}
            </h2>
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="prose prose-sm max-w-none text-foreground/90 dark:prose-invert">
                <MarkdownPreview content={deliverable.content} />
              </div>
            </div>
          </section>
        ) : null}

        {isGuest ? (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3" />
            Sign in to build notebooks and ask questions about your sources.
            <button
              className={cn(
                "ml-auto cursor-pointer rounded border border-border/60 px-2 py-0.5",
                "text-foreground transition-colors hover:border-foreground/40"
              )}
              onClick={() => setShowAuthModal(true)}
              type="button"
            >
              Sign in
            </button>
          </div>
        ) : null}
      </div>

      <GuestAuthModal
        featureName="Notebooks"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});

/**
 * A deliberately small Markdown renderer.
 *
 * The notebook panel shows a deliverable the model already wrote, and the app
 * already has a full Markdown renderer for text artifacts. Rather than bring a
 * second parser in, this renders the subset that matters — headings, lists,
 * paragraphs and emphasis — with the app's existing typography.
 */
function MarkdownPreview({ content }: { content: string }) {
  // The keys are baked in here rather than taken from the map callbacks, so a
  // block and its lines keep their identity when the deliverable is regenerated.
  const blocks = useMemo(
    () =>
      content.split(/\n{2,}/).map((text, index) => {
        const key = `block-${index}`;

        return {
          key,
          lines: text
            .trim()
            .split("\n")
            .map((line, lineIndex) => ({
              key: `${key}-${lineIndex}`,
              text: line,
            })),
          text: text.trim(),
        };
      }),
    [content]
  );

  return (
    <>
      {blocks.map((block) => {
        const { key, text: trimmed } = block;

        if (!trimmed) {
          return null;
        }

        const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);

        if (heading) {
          const level = heading[1].length;

          return (
            <p
              className={cn(
                "font-semibold tracking-tight text-foreground",
                level === 1 ? "text-base" : level === 2 ? "text-sm" : "text-xs"
              )}
              key={key}
            >
              {heading[2]}
            </p>
          );
        }

        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <ul className="flex list-disc flex-col gap-0.5 pl-4" key={key}>
              {block.lines.map((line) => (
                <li key={line.key}>{line.text.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }

        if (/^\d+\.\s+/.test(trimmed)) {
          return (
            <ol className="flex list-decimal flex-col gap-0.5 pl-4" key={key}>
              {block.lines.map((line) => (
                <li key={line.key}>{line.text.replace(/^\d+\.\s+/, "")}</li>
              ))}
            </ol>
          );
        }

        return (
          <p className="text-[12px] leading-relaxed" key={key}>
            {trimmed}
          </p>
        );
      })}
    </>
  );
}
