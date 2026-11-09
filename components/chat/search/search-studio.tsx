"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  type Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { MessageResponse } from "@/components/ai-elements/message";
import { sourceHost, sourceLabel } from "@/lib/ai/search/sources";
import { mergeSearchSources } from "@/lib/search/merge";
import {
  decodeSearchRef,
  type SearchArtifactKind,
  type SearchSource,
} from "@/lib/search/ref";
import { cn } from "@/lib/utils";

/**
 * The full result behind a web search, deep research run or page read.
 *
 * The chat card is a glance; this panel is the reading surface. It keeps the
 * answer/report and every source in one place so a user can check a claim
 * without leaving the conversation.
 */

const KIND_META: Record<
  SearchArtifactKind,
  {
    chip: string;
    icon: typeof Search;
    label: string;
  }
> = {
  page: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: FileText,
    label: "Page read",
  },
  research: {
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    icon: Sparkles,
    label: "Deep research",
  },
  web: {
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    icon: Globe,
    label: "Web search",
  },
};

function sourceLines(sources: SearchSource[]): string[] {
  return sources.map(
    (source, index) => `${index + 1}. [${sourceLabel(source)}](${source.url})`
  );
}

export function SearchStudio({
  content,
  title,
}: {
  content: string;
  title?: string;
}) {
  const [hasCopied, setHasCopied] = useState(false);
  const ref = useMemo(() => decodeSearchRef(content), [content]);
  const sources = useMemo(
    () => mergeSearchSources(ref?.sources),
    [ref?.sources]
  );
  const body = ref?.report ?? ref?.answer ?? "";
  const kind = ref?.kind ?? "web";
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const subject = ref?.query ?? ref?.url ?? title ?? "Search result";

  const handleCopy = useCallback(async () => {
    const text = [
      subject,
      "",
      body,
      ...(sources.length > 0 ? ["", "Sources", ...sourceLines(sources)] : []),
    ]
      .join("\n")
      .trim();

    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setHasCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error("Could not copy the result");
    }
  }, [body, sources, subject]);

  const handleDownload = useCallback(() => {
    const markdown = [
      `# ${subject}`,
      "",
      body,
      ...(sources.length > 0
        ? ["", "## Sources", "", ...sourceLines(sources)]
        : []),
      "",
    ].join("\n");

    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename =
      subject
        .replace(/[^\w\s.-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/^[.-]+/, "")
        .slice(0, 60) || "search-result";

    link.download = `${filename}.md`;
    link.href = url;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [body, sources, subject]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                meta.chip
              )}
            >
              <Icon className="size-3" />
              {meta.label}
            </span>
            {ref?.depth ? (
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {ref.depth}
              </span>
            ) : null}
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
          </div>

          <h2 className="mt-3 text-sm font-semibold leading-snug tracking-tight text-foreground">
            {subject}
          </h2>

          <div className="mt-4 min-w-0">
            {body ? (
              <MessageResponse>{body}</MessageResponse>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                No summary was returned for this result. The sources below are
                the pages that were found.
              </p>
            )}
          </div>

          {sources.length > 0 ? (
            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Sources
                </h3>
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {sources.length}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {sources.map((source, index) => (
                  <a
                    className="group flex min-w-0 items-start gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-border hover:bg-card/70"
                    href={source.url}
                    key={source.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[9px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-foreground/90">
                        {sourceLabel(source)}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/70">
                        {sourceHost(source)}
                      </span>
                    </span>
                    <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 px-4 py-2.5">
        <span className="font-mono text-[10px] text-muted-foreground">
          {sources.length} {sources.length === 1 ? "source" : "sources"} ·{" "}
          {meta.label}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={!body}
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

          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
            disabled={!body && sources.length === 0}
            onClick={handleDownload}
            type="button"
          >
            <Download className="size-3" />
            Markdown
          </button>
        </div>
      </div>
    </div>
  );
}
