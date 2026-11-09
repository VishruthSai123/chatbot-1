"use client";

import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useArtifact } from "@/hooks/use-artifact";
import { sourceHost, sourceLabel } from "@/lib/ai/search/sources";
import { mergeSearchSources } from "@/lib/search/merge";
import { encodeSearchRef, type SearchSource } from "@/lib/search/ref";
import { cn } from "@/lib/utils";

/**
 * The result card for web search, page reading and deep research.
 *
 * The card is a glance: the question, a short answer, the sites that back it,
 * and one way into the full reading surface. The full report and every source
 * live in the Search Studio so the chat stays readable.
 */

export type SearchToolType =
  | "tool-webSearch"
  | "tool-readUrl"
  | "tool-research";

export type { SearchSource } from "@/lib/search/ref";

export interface SearchToolOutput {
  answer?: string;
  content?: string;
  depth?: "quick" | "standard" | "thorough";
  error?: string;
  query?: string;
  report?: string;
  sources?: SearchSource[];
  topic?: string;
  url?: string;
}

interface SearchToolCardProps {
  isReadonly?: boolean;
  output?: SearchToolOutput;
  toolCallId: string;
  toolType: SearchToolType;
}

const TOOL_CONFIG: Record<
  SearchToolType,
  {
    badge: string;
    icon: typeof Globe;
    label: string;
  }
> = {
  "tool-readUrl": {
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: FileText,
    label: "Page Read",
  },
  "tool-research": {
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    icon: Sparkles,
    label: "Deep Research",
  },
  "tool-webSearch": {
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    icon: Globe,
    label: "Web Search",
  },
};

/** Markdown is for the panel; the card reads better as clean prose. */
function plainPreview(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function SearchToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
}: SearchToolCardProps) {
  const { setArtifact } = useArtifact();
  const cardRef = useRef<HTMLDivElement>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? TOOL_CONFIG["tool-webSearch"];
  const Icon = config.icon;
  const sources = useMemo(
    () => mergeSearchSources(output?.sources),
    [output?.sources]
  );

  const rawBody = output?.report ?? output?.answer ?? output?.content ?? "";
  const body = plainPreview(rawBody);
  const subject = output?.topic ?? output?.query ?? output?.url ?? "";
  const isDone = Boolean(output);
  const isLong = body.length > (toolType === "tool-research" ? 480 : 320);
  const previewSources = sources.slice(0, 3);

  const handleOpen = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    const kind =
      toolType === "tool-research"
        ? "research"
        : toolType === "tool-readUrl"
          ? "page"
          : "web";

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
      content: encodeSearchRef({
        answer: output?.answer,
        depth: output?.depth,
        kind,
        query: output?.query,
        report: output?.report,
        sources,
        url: output?.url,
      }),
      documentId: "init",
      isVisible: true,
      kind: "search",
      status: "idle",
      subtitle: `${sources.length} ${
        sources.length === 1 ? "source" : "sources"
      } · ${config.label}`,
      title: subject || config.label,
    }));
  }, [config.label, output, setArtifact, sources, subject, toolType]);

  const handleCopy = useCallback(async () => {
    if (!rawBody) {
      return;
    }

    try {
      await navigator.clipboard.writeText(rawBody);
      setHasCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error("Could not copy the result");
    }
  }, [rawBody]);

  return (
    <div
      className="group flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90"
      ref={cardRef}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md",
              config.badge
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
          {output?.depth ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {output.depth}
            </span>
          ) : null}
          {sources.length > 0 ? (
            <span
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={`${sources.length} ${sources.length === 1 ? "source" : "sources"}`}
            >
              {sources.length}
            </span>
          ) : null}
        </div>
      </div>

      {/* Subject */}
      {subject ? (
        <p className="mt-2.5 line-clamp-2 text-[12px] font-medium leading-snug text-foreground/90">
          {subject}
        </p>
      ) : null}

      {/* Body */}
      {body ? (
        <div className="mt-2">
          <p
            className={cn(
              "whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80",
              isLong &&
                !isExpanded &&
                (toolType === "tool-research" ? "line-clamp-4" : "line-clamp-3")
            )}
          >
            {body}
          </p>
          {isLong ? (
            <button
              className="mt-1 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={() => setIsExpanded((current) => !current)}
              type="button"
            >
              {isExpanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : isDone ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          No summary was returned. Open the details to view the sources.
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Searching…
        </div>
      )}

      {/* Source preview */}
      {previewSources.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {previewSources.map((source) => (
            <a
              className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              href={source.url}
              key={source.url}
              rel="noreferrer noopener"
              target="_blank"
              title={sourceLabel(source)}
            >
              <Globe className="size-2.5 shrink-0" />
              <span className="max-w-[110px] truncate">
                {sourceHost(source)}
              </span>
            </a>
          ))}
          {sources.length > previewSources.length ? (
            <button
              className="rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={handleOpen}
              type="button"
            >
              +{sources.length - previewSources.length}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
          onClick={handleOpen}
          type="button"
        >
          <PanelRightOpen className="size-3" />
          Open details
        </button>

        <div className="flex items-center gap-1.5">
          {output?.url ? (
            <a
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              href={output.url}
              rel="noreferrer noopener"
              target="_blank"
            >
              <ExternalLink className="size-3" />
              Open page
            </a>
          ) : null}
          <button
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={!rawBody}
            onClick={handleCopy}
            type="button"
          >
            {hasCopied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3" />
            )}
            {hasCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
