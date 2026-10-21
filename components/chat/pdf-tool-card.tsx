"use client";

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react";
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

export type PdfToolType =
  | "tool-pdfGetInfo"
  | "tool-pdfMerge"
  | "tool-pdfSplit"
  | "tool-pdfArrange"
  | "tool-pdfRotatePages"
  | "tool-pdfExtractText"
  | "tool-imageToPdf";

export interface PdfToolOutput {
  documentId?: string;
  error?: string;
  files?: Array<{
    filename: string;
    pages: number;
    sizeBytes?: number;
    url?: string;
  }>;
  imageCount?: number;
  mergedCount?: number;
  metadata?: {
    pageCount?: number;
    fileSizeBytes?: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    isEncrypted?: boolean;
    creationDate?: string;
    modificationDate?: string;
  };
  pages?: number;
  sizeBytes?: number;
  text?: string;
  title?: string;
  totalPages?: number;
  truncated?: boolean;
  url?: string;
}

interface PdfToolCardProps {
  isReadonly?: boolean;
  output?: PdfToolOutput;
  toolCallId: string;
  toolType: PdfToolType;
}

const TOOL_CONFIG: Record<
  PdfToolType,
  {
    icon: string;
    label: string;
    accentColor: string;
  }
> = {
  "tool-imageToPdf": {
    accentColor: "text-emerald-500",
    icon: "🖼️",
    label: "Images to PDF",
  },
  "tool-pdfArrange": {
    accentColor: "text-amber-500",
    icon: "🔀",
    label: "Arrange Pages",
  },
  "tool-pdfExtractText": {
    accentColor: "text-emerald-500",
    icon: "📝",
    label: "Extract Text",
  },
  "tool-pdfGetInfo": {
    accentColor: "text-blue-500",
    icon: "📄",
    label: "Inspect PDF",
  },
  "tool-pdfMerge": {
    accentColor: "text-indigo-500",
    icon: "📑",
    label: "Merge PDFs",
  },
  "tool-pdfRotatePages": {
    accentColor: "text-violet-500",
    icon: "🔄",
    label: "Rotate Pages",
  },
  "tool-pdfSplit": {
    accentColor: "text-rose-500",
    icon: "✂️",
    label: "Split / Extract Pages",
  },
};

export function PdfToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
  isReadonly,
}: PdfToolCardProps) {
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasCopiedText, setHasCopiedText] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? {
    accentColor: "text-rose-500",
    icon: "📄",
    label: "PDF Operation",
  };

  const documentId = output?.documentId;

  const { data: documents } = useSWR<Document[]>(
    documentId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${documentId}`
      : null,
    fetcher
  );

  const docRecord = documents?.at(-1);
  const title = output?.title || docRecord?.title || "PDF Document";

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
      kind: "pdf",
      status: "idle",
      title,
    }));
  }, [isReadonly, isGuest, documentId, setArtifact, docRecord?.content, title]);

  const triggerDownloadUrl = useCallback((url: string, filename?: string) => {
    const link = window.document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (filename) {
      link.download = filename;
    }
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    toast.success("Download started");
  }, []);

  const handleDownload = useCallback(
    async (fileUrl?: string, filename?: string) => {
      if (isGuest) {
        setShowAuthModal(true);
        return;
      }

      if (fileUrl) {
        triggerDownloadUrl(fileUrl, filename);
        return;
      }

      if (output?.url) {
        triggerDownloadUrl(output.url, `${title.replace(/\.pdf$/i, "")}.pdf`);
        return;
      }

      if (!documentId) {
        toast.error("File download is not available for this operation.");
        return;
      }

      setIsDownloading(true);
      try {
        const response = await fetch(toolEndpoint("pdf"), {
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

        const data = await response.json();
        if (!response.ok || !data?.result?.url) {
          throw new Error(data?.error || "Failed to resolve download URL");
        }

        triggerDownloadUrl(
          data.result.url,
          data.result.filename || `${title.replace(/\.pdf$/i, "")}.pdf`
        );
      } catch (err: any) {
        console.error("Failed to download PDF:", err);
        toast.error(err.message || "Failed to download PDF");
      } finally {
        setIsDownloading(false);
      }
    },
    [isGuest, output?.url, title, documentId, triggerDownloadUrl]
  );

  const handleCopyText = useCallback(async () => {
    if (!output?.text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(output.text);
      setHasCopiedText(true);
      toast.success("Extracted text copied to clipboard");
      setTimeout(() => setHasCopiedText(false), 2000);
    } catch {
      toast.error("Failed to copy text");
    }
  }, [output?.text]);

  const pageCount =
    output?.pages ?? output?.metadata?.pageCount ?? output?.totalPages;

  return (
    <div
      className={cn(
        "group relative flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90"
      )}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-sm select-none">{config.icon}</span>
          <span className="text-xs font-semibold text-foreground tracking-tight">
            {config.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {output?.mergedCount ? (
            <span className="rounded bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-indigo-500 dark:text-indigo-400">
              {output.mergedCount} files merged
            </span>
          ) : null}

          {output?.imageCount ? (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-500 dark:text-emerald-400">
              {output.imageCount} {output.imageCount === 1 ? "image" : "images"}{" "}
              converted
            </span>
          ) : null}

          {typeof pageCount === "number" ? (
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>
          ) : null}

          {output?.sizeBytes ? (
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
              {formatBytes(output.sizeBytes)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Middle Body Row */}
      <div className="flex items-start gap-3 py-2.5">
        {/* Interactive PDF Badge Thumbnail Button */}
        <button
          className="group/thumb relative flex size-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 shadow-inner transition-colors hover:border-rose-500/40 hover:bg-rose-500/20 focus:outline-none cursor-pointer"
          onClick={handleOpenStudio}
          title="Open in PDF Studio"
          type="button"
        >
          <FileText className="size-6 transition-transform group-hover/thumb:scale-110" />
          <span className="mt-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            PDF
          </span>
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-[1px] transition-opacity group-hover/thumb:opacity-100">
            <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">
              Studio
            </span>
          </div>
        </button>

        {/* Details & Telemetry */}
        <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
          <button
            className="truncate text-left text-xs font-medium text-foreground hover:underline cursor-pointer"
            onClick={handleOpenStudio}
            title={title}
            type="button"
          >
            {title}
          </button>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {typeof pageCount === "number" ? (
              <span>
                {pageCount} {pageCount === 1 ? "page" : "pages"}
              </span>
            ) : null}

            {output?.metadata?.author ? (
              <>
                <span>•</span>
                <span className="truncate max-w-[140px]">
                  By {output.metadata.author}
                </span>
              </>
            ) : null}

            {output?.metadata?.isEncrypted ? (
              <>
                <span>•</span>
                <span className="text-amber-500">Encrypted</span>
              </>
            ) : null}
          </div>

          {/* Text preview if extract text tool was used */}
          {output?.text ? (
            <div className="mt-1 rounded-md border border-border/50 bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <p className="line-clamp-2 leading-relaxed font-sans text-foreground/90">
                {output.text}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/30 pt-1 text-[10px]">
                <span>
                  {output.truncated
                    ? "Preview of first pages"
                    : `${output.text.length} characters`}
                </span>
                <button
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={handleCopyText}
                  type="button"
                >
                  {hasCopiedText ? (
                    <Check className="size-3 text-emerald-500" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  <span>{hasCopiedText ? "Copied" : "Copy text"}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Multiple Split Files List if present */}
      {output?.files && output.files.length > 1 ? (
        <div className="mt-1 mb-2 space-y-1.5 rounded-lg border border-border/40 bg-muted/30 p-2">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Split Output Files ({output.files.length})
          </div>
          <div className="max-h-36 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {output.files.map((file, idx) => (
              <div
                className="flex items-center justify-between gap-2 rounded bg-background/60 px-2 py-1 text-xs"
                key={file.filename || idx}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="size-3.5 text-rose-500 shrink-0" />
                  <span className="truncate text-[11px] font-medium text-foreground">
                    {file.filename}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    ({file.pages} {file.pages === 1 ? "page" : "pages"})
                  </span>
                </div>
                <button
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-muted"
                  onClick={() => handleDownload(file.url, file.filename)}
                  title={`Download ${file.filename}`}
                  type="button"
                >
                  <Download className="size-3" />
                  <span>Download</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Bottom Action Footer Row */}
      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={handleOpenStudio}
          type="button"
        >
          <ExternalLink className="size-3.5" />
          <span>Open in Studio</span>
        </button>

        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
          disabled={isDownloading}
          onClick={() => handleDownload()}
          type="button"
        >
          {isDownloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          <span>{isDownloading ? "Preparing..." : "Download PDF"}</span>
        </button>
      </div>

      <GuestAuthModal
        featureName="PDF Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
}
