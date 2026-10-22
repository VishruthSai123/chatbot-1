"use client";

import {
  Check,
  Download,
  FileVideo,
  Loader2,
  Music,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { encodeAsMp3 } from "@/lib/media/mp3-client";
import { cn } from "@/lib/utils";

/**
 * The download card.
 *
 * A downloaded file, with the two things a user actually wants next: save it as
 * it is, or save it as an MP3.
 *
 * The MP3 button is where the browser-side encoder earns its place. The server
 * never transcodes — it hands over the audio track and the browser re-encodes it
 * locally, so there is no 80 MB FFmpeg binary in the deployment and the
 * converted file never leaves the user's machine.
 */

export type MediaToolType = "tool-downloadMedia";

export interface MediaToolOutput {
  documentId?: string;
  duration?: number;
  error?: string;
  filename?: string;
  format?: "video" | "audio";
  sizeBytes?: number;
  sourceUrl?: string;
  title?: string;
  url?: string;
}

interface MediaToolCardProps {
  output?: MediaToolOutput;
  toolCallId: string;
  toolType: MediaToolType;
}

const QUALITIES = [
  { label: "720p", value: 720 },
  { label: "1080p", value: 1080 },
  { label: "1440p", value: 1440 },
  { label: "4K", value: 2160 },
];

export function MediaToolCard({
  output,
  toolType: _toolType,
}: MediaToolCardProps) {
  const [quality, setQuality] = useState(1080);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [hasEncoded, setHasEncoded] = useState(false);

  const title = output?.title ?? "Download";
  const isAudio = output?.format === "audio";

  const handleDownload = useCallback(() => {
    if (!output?.url) {
      return;
    }

    const link = document.createElement("a");

    link.download = output.filename ?? title;
    link.href = output.url;
    link.click();
  }, [output, title]);

  /**
   * Converts the downloaded audio to MP3, in the browser.
   */
  const handleMp3 = useCallback(async () => {
    if (!(output?.url && output.sizeBytes)) {
      return;
    }

    setIsEncoding(true);
    setEncodeProgress(0);
    const toastId = toast.loading("Converting to MP3 in your browser…");

    try {
      const encoded = await encodeAsMp3({
        onProgress: (progress) => setEncodeProgress(progress.progress),
        sourceUrl: output.url,
        title,
      });

      const url = URL.createObjectURL(encoded.blob);
      const link = document.createElement("a");

      link.download = encoded.filename;
      link.href = url;
      link.click();

      // The object URL is released once the browser has taken the download.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setHasEncoded(true);
      toast.success("MP3 ready", { id: toastId });
    } catch (error: any) {
      toast.error(
        error?.message ?? "This audio could not be converted to MP3.",
        { id: toastId }
      );
    } finally {
      setIsEncoding(false);
    }
  }, [output, title]);

  return (
    <div className="flex w-full max-w-[440px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {isAudio ? (
            <Music className="size-3.5 shrink-0 text-zinc-500" />
          ) : (
            <FileVideo className="size-3.5 shrink-0 text-zinc-500" />
          )}
          <span className="text-xs font-semibold tracking-tight text-foreground">
            Download
          </span>
        </div>

        {output?.sizeBytes ? (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {formatSize(output.sizeBytes)}
          </span>
        ) : null}
      </div>

      {/* Title */}
      <div className="mt-2">
        <p className="truncate text-[12px] font-medium text-foreground/90">
          {title}
        </p>
        {output?.duration ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {formatDuration(output.duration)}
            {output.sourceUrl ? ` · ${hostOf(output.sourceUrl)}` : ""}
          </p>
        ) : null}
      </div>

      {/* Quality */}
      {!isAudio && output?.url ? (
        <div className="mt-2.5 flex items-center gap-1">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
            Quality
          </span>
          {QUALITIES.map((option) => (
            <button
              className={cn(
                "cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                quality === option.value
                  ? "border-foreground/40 bg-muted text-foreground"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              )}
              key={option.value}
              onClick={() => setQuality(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2.5">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
          disabled={!output?.url}
          onClick={handleDownload}
          type="button"
        >
          <Download className="size-3" />
          {output?.filename ?? "Download"}
        </button>

        {!isAudio && output?.url ? (
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={isEncoding}
            onClick={handleMp3}
            type="button"
          >
            {isEncoding ? (
              <Loader2 className="size-3 animate-spin" />
            ) : hasEncoded ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Music className="size-3" />
            )}
            {isEncoding
              ? `Converting ${Math.round(encodeProgress * 100)}%`
              : "Save as MP3"}
          </button>
        ) : null}
      </div>

      {isEncoding ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-foreground transition-[width] duration-150"
            style={{ width: `${Math.round(encodeProgress * 100)}%` }}
          />
        </div>
      ) : null}

      {!isAudio && output?.url ? (
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-tight text-muted-foreground/70">
          <TriangleAlert className="mt-px size-2.5 shrink-0" />
          MP3 conversion happens in your browser. The file is not uploaded
          anywhere.
        </p>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
