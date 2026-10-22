"use client";

import {
  ArrowRight,
  Clock,
  FileText,
  GitCompare,
  ListTree,
  Type,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The result card for the document tools.
 *
 * The diff view is the interesting one. It is rendered as *two columns* — the
 * old document and the new one — because a diff is a comparison, and a single
 * interleaved stream of red and green is much harder to read than two texts
 * side by side.
 */

export type DocToolType =
  | "tool-docRead"
  | "tool-docSummarize"
  | "tool-docDiff"
  | "tool-docStats"
  | "tool-docConvert";

export interface DocToolOutput {
  added?: number;
  characters?: number;
  content?: string;
  documentA?: string;
  documentB?: string;
  error?: string;
  minutesToRead?: number;
  outline?: { level: number; text: string }[];
  paragraphs?: number;
  removed?: number;
  segments?: { kind: "equal" | "insert" | "delete"; text: string }[];
  sentences?: number;
  summary?: string;
  text?: string;
  unchanged?: number;
  words?: number;
}

interface DocToolCardProps {
  isReadonly?: boolean;
  output?: DocToolOutput;
  toolCallId: string;
  toolType: DocToolType;
}

const TOOL_CONFIG: Record<
  DocToolType,
  { icon: typeof FileText; label: string }
> = {
  "tool-docConvert": { icon: FileText, label: "Converted" },
  "tool-docDiff": { icon: GitCompare, label: "Comparison" },
  "tool-docRead": { icon: FileText, label: "Document" },
  "tool-docStats": { icon: ListTree, label: "Document Structure" },
  "tool-docSummarize": { icon: FileText, label: "Summary" },
};

/** The class a diff segment gets. */
function segmentClass(kind: "equal" | "insert" | "delete"): string {
  if (kind === "insert") {
    return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  }

  if (kind === "delete") {
    return "bg-red-500/12 text-red-600 dark:text-red-400 line-through";
  }

  return "";
}

/**
 * Splits a diff into the two sides of a side-by-side view.
 *
 * A deletion and an insertion next to each other are the *same* edit seen from
 * two sides, so they are paired into one row: the left column shows what was
 * removed, the right shows what replaced it. Without that pairing the reader
 * has to hunt for the matching change.
 */
function pairDiff(
  segments: { kind: "equal" | "insert" | "delete"; text: string }[]
): { left: string; right: string; changed: boolean }[] {
  const rows: { left: string; right: string; changed: boolean }[] = [];
  const lines = (text: string) =>
    text.split("\n").filter((line) => line !== "");

  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];

    if (segment.kind === "equal") {
      for (const line of lines(segment.text)) {
        rows.push({ changed: false, left: line, right: line });
      }
      index += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];

    while (index < segments.length && segments[index].kind !== "equal") {
      const current = segments[index];

      if (current.kind === "delete") {
        removed.push(...lines(current.text));
      } else {
        added.push(...lines(current.text));
      }

      index += 1;
    }

    const count = Math.max(removed.length, added.length);

    for (let line = 0; line < count; line += 1) {
      rows.push({
        changed: true,
        left: removed[line] ?? "",
        right: added[line] ?? "",
      });
    }
  }

  return rows;
}

export function DocToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
}: DocToolCardProps) {
  const [showAll, setShowAll] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? TOOL_CONFIG["tool-docRead"];
  const Icon = config.icon;

  const isDiff = toolType === "tool-docDiff" && output?.segments;
  const rows = isDiff ? pairDiff(output.segments ?? []) : [];
  const visibleRows = showAll ? rows : rows.slice(0, 24);

  const body = output?.summary ?? output?.text ?? output?.content ?? "";

  return (
    <div className="flex w-full max-w-[560px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-zinc-500" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
        </div>

        {isDiff ? (
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
              +{output?.added ?? 0}
            </span>
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
              −{output?.removed ?? 0}
            </span>
          </div>
        ) : null}
      </div>

      {/* Body */}
      {isDiff ? (
        <div className="mt-2.5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/50 bg-border/40 font-mono text-[10px]">
            <div className="bg-muted/60 px-2 py-1 font-medium text-muted-foreground">
              Before
            </div>
            <div className="bg-muted/60 px-2 py-1 font-medium text-muted-foreground">
              After
            </div>

            {visibleRows.map((row) => (
              <div
                className="contents"
                key={`${row.left}::${row.right}::${row.changed}`}
              >
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words bg-card px-2 py-0.5",
                    row.changed && "bg-red-500/8"
                  )}
                >
                  {row.left}
                </div>
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words bg-card px-2 py-0.5",
                    row.changed && "bg-emerald-500/8"
                  )}
                >
                  {row.right}
                </div>
              </div>
            ))}
          </div>

          {rows.length > 24 ? (
            <button
              className="mt-1.5 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={() => setShowAll((current) => !current)}
              type="button"
            >
              {showAll ? "Show fewer lines" : `Show all ${rows.length} lines`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2">
          {body ? (
            <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                {body.slice(0, 3000)}
              </p>
            </div>
          ) : null}

          {output?.outline && output.outline.length > 0 ? (
            <div className="mt-2.5 border-t border-border/40 pt-2">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Outline
              </div>
              <ul className="flex flex-col gap-0.5">
                {output.outline.slice(0, 12).map((heading) => (
                  <li
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    key={`${heading.level}-${heading.text}`}
                    style={{ paddingLeft: (heading.level - 1) * 10 }}
                  >
                    <ArrowRight className="size-2.5 shrink-0 opacity-50" />
                    <span className="truncate">{heading.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {output?.words ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-3 border-t border-border/40 pt-2 font-mono text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Type className="size-3" />
                {output.words.toLocaleString()} words
              </span>
              <span className="flex items-center gap-1">
                <FileText className="size-3" />
                {output.paragraphs?.toLocaleString() ?? 0} paragraphs
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {output.minutesToRead ?? 0} min read
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Exported for the unit tests, which cover the pairing logic. */
export { pairDiff, segmentClass };
