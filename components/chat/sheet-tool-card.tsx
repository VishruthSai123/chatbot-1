"use client";

import { Check, Copy, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import type { Document } from "@/lib/db/schema";
import { formatBytes } from "@/lib/storage/limits";
import { toolEndpoint } from "@/lib/tools/endpoint";
import { cn, fetcher } from "@/lib/utils";

export type SheetToolType =
  | "tool-sheetGetInfo"
  | "tool-sheetFilterSort"
  | "tool-sheetRemoveDuplicates"
  | "tool-sheetSummaryStats"
  | "tool-sheetConvertFormat";

export interface SheetToolOutput {
  after?: number;
  before?: number;
  columns?: string[];
  documentId?: string;
  error?: string;
  filename?: string;
  format?: string;
  removed?: number;
  rows?: number;
  sheetNames?: string[];
  sizeBytes?: number;
  stats?: {
    count: number;
    max?: number | string | boolean | null;
    mean?: number;
    median?: number;
    min?: number | string | boolean | null;
    name: string;
    nullCount: number;
    type: string;
    uniqueCount: number;
  }[];
  title?: string;
  totalRows?: number;
  url?: string;
}

interface SheetToolCardProps {
  isReadonly?: boolean;
  output?: SheetToolOutput;
  toolCallId: string;
  toolType: SheetToolType;
}

const TOOL_CONFIG: Record<
  SheetToolType,
  { icon: string; label: string; accent: string }
> = {
  "tool-sheetConvertFormat": {
    accent: "text-sky-500",
    icon: "🔄",
    label: "Convert Format",
  },
  "tool-sheetFilterSort": {
    accent: "text-amber-500",
    icon: "🔀",
    label: "Filter & Sort",
  },
  "tool-sheetGetInfo": {
    accent: "text-zinc-500",
    icon: "📊",
    label: "Inspect Sheet",
  },
  "tool-sheetRemoveDuplicates": {
    accent: "text-rose-500",
    icon: "🧹",
    label: "Remove Duplicates",
  },
  "tool-sheetSummaryStats": {
    accent: "text-emerald-500",
    icon: "📈",
    label: "Summary Stats",
  },
};

export function SheetToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
  isReadonly,
}: SheetToolCardProps) {
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? {
    accent: "text-zinc-500",
    icon: "📊",
    label: "Data Operation",
  };

  const documentId = output?.documentId;

  const { data: documents } = useSWR<Document[]>(
    documentId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${documentId}`
      : null,
    fetcher
  );

  const docRecord = documents?.at(-1);
  const title = output?.title || docRecord?.title || "Spreadsheet";

  const handleOpenStudio = useCallback(() => {
    if (isReadonly) {
      toast.error("Viewing documents in shared chats is not supported.");
      return;
    }

    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    if (!documentId) {
      return;
    }

    setArtifact((current) => ({
      ...current,
      content: docRecord?.content || current.content,
      documentId,
      isVisible: true,
      kind: "sheet",
      status: "idle",
      title,
    }));
  }, [documentId, docRecord?.content, isGuest, isReadonly, setArtifact, title]);

  const handleDownload = useCallback(async () => {
    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    if (!documentId) {
      toast.error("Download is not available for this operation.");
      return;
    }

    setIsDownloading(true);

    try {
      const response = await fetch(toolEndpoint("sheet"), {
        body: JSON.stringify({
          action: "resolve",
          documentId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.status === 403) {
        setShowAuthModal(true);
        return;
      }

      const payload = await response.json();

      if (!response.ok || !payload?.result?.url) {
        throw new Error(payload?.error || "Could not prepare the download.");
      }

      const link = window.document.createElement("a");

      link.href = payload.result.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = payload.result.filename || title;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      toast.success("Download started");
    } catch (error: any) {
      toast.error(error.message ?? "Download failed");
    } finally {
      setIsDownloading(false);
    }
  }, [documentId, isGuest, title]);

  const handleCopyStats = useCallback(async () => {
    if (!output?.stats) {
      return;
    }

    const text = output.stats
      .map((stat) => {
        const parts = [
          stat.name,
          `count=${stat.count}`,
          `empty=${stat.nullCount}`,
          `unique=${stat.uniqueCount}`,
        ];

        if (stat.mean !== undefined) {
          parts.push(`mean=${stat.mean}`);
        }

        if (stat.median !== undefined) {
          parts.push(`median=${stat.median}`);
        }

        return parts.join("  ");
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setHasCopied(true);
      toast.success("Statistics copied");
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error("Could not copy the statistics");
    }
  }, [output?.stats]);

  const rowCount = output?.rows ?? output?.totalRows;
  const changed =
    typeof output?.before === "number" && typeof output?.after === "number"
      ? output.before !== output.after
      : false;

  return (
    <div className="group relative flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm select-none">{config.icon}</span>
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {changed ? (
            <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {output?.before} → {output?.after} rows
            </span>
          ) : null}

          {output?.removed ? (
            <span className="rounded bg-rose-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {output.removed} removed
            </span>
          ) : null}

          {typeof rowCount === "number" ? (
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
              {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
            </span>
          ) : null}

          {output?.sizeBytes ? (
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
              {formatBytes(output.sizeBytes)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="flex items-start gap-3 py-2.5">
        <button
          className={cn(
            "group/thumb relative flex size-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-inner transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/20 focus:outline-none cursor-pointer"
          )}
          onClick={handleOpenStudio}
          title="Open in Data Studio"
          type="button"
        >
          <FileSpreadsheet className="size-6 transition-transform group-hover/thumb:scale-110" />
          <span className="mt-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Data
          </span>
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-[1px] transition-opacity group-hover/thumb:opacity-100">
            <span className="rounded bg-emerald-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">
              Studio
            </span>
          </div>
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <button
            className="cursor-pointer truncate text-left text-xs font-medium text-foreground hover:underline"
            onClick={handleOpenStudio}
            title={title}
            type="button"
          >
            {title}
          </button>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {output?.format ? (
              <>
                <span className="uppercase">{output.format}</span>
                <span>•</span>
              </>
            ) : null}

            {output?.columns?.length ? (
              <>
                <span>
                  {output.columns.length}{" "}
                  {output.columns.length === 1 ? "column" : "columns"}
                </span>
                <span>•</span>
              </>
            ) : null}

            {output?.sheetNames && output.sheetNames.length > 1 ? (
              <span>{output.sheetNames.length} sheets</span>
            ) : null}
          </div>

          {output?.stats?.length ? (
            <div className="mt-1 rounded-md border border-border/50 bg-muted/40 p-2">
              <div className="max-h-28 overflow-auto">
                <table className="w-full font-mono text-[10px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-1 text-left font-medium">Column</th>
                      <th className="pb-1 text-right font-medium">Count</th>
                      <th className="pb-1 text-right font-medium">Empty</th>
                      <th className="pb-1 text-right font-medium">Mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {output.stats.slice(0, 6).map((stat) => (
                      <tr key={stat.name}>
                        <td className="truncate pr-2 text-foreground/90">
                          {stat.name}
                        </td>
                        <td className="text-right tabular-nums">
                          {stat.count}
                        </td>
                        <td className="text-right tabular-nums">
                          {stat.nullCount}
                        </td>
                        <td className="text-right tabular-nums">
                          {stat.mean === undefined
                            ? "—"
                            : stat.mean.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/30 pt-1 text-[10px]">
                <span>
                  {output.stats.length} columns
                  {output.stats.length > 6 ? " (showing 6)" : ""}
                </span>
                <button
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={handleCopyStats}
                  type="button"
                >
                  {hasCopied ? (
                    <Check className="size-3 text-emerald-500" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  <span>{hasCopied ? "Copied" : "Copy stats"}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-1.5 border-t border-border/40 pt-2.5">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          disabled={isDownloading}
          onClick={handleDownload}
          type="button"
        >
          {isDownloading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Download className="size-3" />
          )}
          Download
        </button>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleOpenStudio}
          type="button"
        >
          <FileSpreadsheet className="size-3" />
          Open Studio
        </button>
      </div>

      <GuestAuthModal
        featureName="Data Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
}
