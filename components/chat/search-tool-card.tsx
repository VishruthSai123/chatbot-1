"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Search,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { sourceHost, sourceLabel } from "@/lib/ai/search/sources";
import { cn } from "@/lib/utils";

/**
 * The result card for web search, page reading and deep research.
 *
 * The card exists for one reason: **the sources are the point**. A grounded
 * answer without the pages it came from is just an answer, and the user cannot
 * check it, cannot follow it, and cannot tell a good answer from a confident
 * one. So the sources are shown first-class, not buried.
 */

export type SearchToolType =
  | "tool-webSearch"
  | "tool-readUrl"
  | "tool-research";

export interface SearchSource {
  title?: string;
  url: string;
}

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
  { accent: string; icon: typeof Search; label: string }
> = {
  "tool-readUrl": {
    accent: "text-zinc-500",
    icon: Globe,
    label: "Read Page",
  },
  "tool-research": {
    accent: "text-sky-500",
    icon: Search,
    label: "Deep Research",
  },
  "tool-webSearch": {
    accent: "text-zinc-500",
    icon: Search,
    label: "Web Search",
  },
};

export function SearchToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
}: SearchToolCardProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? TOOL_CONFIG["tool-webSearch"];
  const Icon = config.icon;

  const body = output?.report ?? output?.answer ?? output?.content ?? "";

  // The same page can appear twice when two queries surface it. Showing it twice
  // makes the source list look padded, so it is collapsed here as well as in the
  // normaliser.
  const uniqueSources = (output?.sources ?? []).filter(
    (source, index, all) =>
      all.findIndex((other) => other.url === source.url) === index
  );

  const subject = output?.topic ?? output?.query ?? output?.url ?? "";

  const handleCopy = useCallback(async () => {
    if (!body) {
      return;
    }

    try {
      await navigator.clipboard.writeText(body);
      setHasCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error("Could not copy the result");
    }
  }, [body]);

  const isLong = body.length > 600;

  return (
    <div className="group flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-3.5 shrink-0", config.accent)} />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
          {output?.depth ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {output.depth}
            </span>
          ) : null}
        </div>

        {body ? (
          <button
            aria-label="Copy result"
            className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={handleCopy}
            type="button"
          >
            {hasCopied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {/* Subject */}
      {subject ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          {subject}
        </p>
      ) : null}

      {/* Body */}
      {body ? (
        <div className="mt-2">
          <p
            className={cn(
              "whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90",
              isLong && !isExpanded && "line-clamp-6"
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
      ) : (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Searching…
        </div>
      )}

      {/* Sources */}
      {uniqueSources.length > 0 ? (
        <div className="mt-3 border-t border-border/40 pt-2.5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {uniqueSources.length}{" "}
            {uniqueSources.length === 1 ? "source" : "sources"}
          </div>
          <div className="flex flex-col gap-1">
            {uniqueSources.slice(0, 8).map((source, index) => (
              <a
                className="group/source flex items-start gap-1.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                href={source.url}
                key={source.url}
                rel="noreferrer noopener"
                target="_blank"
              >
                <span className="mt-px font-mono text-[9px] text-muted-foreground/60">
                  [{index + 1}]
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {sourceLabel(source)}
                </span>
                <span className="mt-px shrink-0 font-mono text-[9px] text-muted-foreground/50">
                  {sourceHost(source)}
                </span>
                <ExternalLink className="mt-px size-2.5 shrink-0 opacity-0 transition-opacity group-hover/source:opacity-70" />
              </a>
            ))}
          </div>
          {uniqueSources.length > 8 ? (
            <p className="mt-1 px-1 font-mono text-[10px] text-muted-foreground/70">
              +{uniqueSources.length - 8} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
