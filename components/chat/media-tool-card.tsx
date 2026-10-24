"use client";

import {
  Check,
  Download,
  FileVideo,
  Loader2,
  Music,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
 *
 * Two things this card has to get right:
 *
 * - **A platform that publishes the picture and the sound apart** gives two
 *   files. Both are offered, and the MP3 is made from the sound one, because
 *   the picture on its own has nothing to convert.
 * - **The quality buttons actually change the file.** Choosing 720p downloads
 *   the video again at 720p; a button that only changes how it looks is worse
 *   than no button at all.
 */

export type MediaToolType = "tool-downloadMedia";

/** One downloaded file. */
export interface MediaToolFile {
  documentId?: string;
  filename?: string;
  sizeBytes?: number;
  url?: string;
}

export interface MediaToolOutput {
  /**
   * The sound track, when the platform publishes the picture and the sound
   * apart — which is what YouTube does.
   */
  companion?: MediaToolFile;
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
  /**
   * The card keeps its own copy of the download.
   *
   * Choosing another quality downloads the file again, and the new file has
   * to replace the old one on screen — which cannot be done by changing a
   * prop that belongs to the message.
   */
  const [current, setCurrent] = useState<MediaToolOutput | undefined>(output);
  const [quality, setQuality] = useState(1080);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [hasEncoded, setHasEncoded] = useState(false);
  const [isRedownloading, setIsRedownloading] = useState(false);

  useEffect(() => {
    setCurrent(output);
  }, [output]);

  const title = current?.title ?? "Download";
  const isAudio = current?.format === "audio";
  const companion = current?.companion?.url ? current.companion : undefined;

  /**
   * The file the MP3 is made from.
   *
   * When the platform published the sound separately, that is the sound track.
   * Otherwise it is the download itself, which carries its own sound.
   */
  const mp3Source = companion?.url ?? current?.url;

  /**
   * The size of everything on offer.
   *
   * When the platform published the sound separately there are two files, and
   * the badge has to count both — a badge that counts one of them is a small
   * lie.
   */
  const totalBytes = (current?.sizeBytes ?? 0) + (companion?.sizeBytes ?? 0);

  /**
   * Whether an MP3 can be made from this file.
   *
   * The conversion is offered for *audio* downloads too — that is when it is
   * most wanted. It is only pointless when the file is already an MP3.
   */
  const canConvertToMp3 = Boolean(
    mp3Source &&
      !current?.filename?.toLowerCase().endsWith(".mp3") &&
      !companion?.filename?.toLowerCase().endsWith(".mp3")
  );

  const handleDownload = useCallback(
    (file?: MediaToolFile, fallback?: string) => {
      const url = file?.url ?? current?.url;

      if (!url) {
        return;
      }

      const link = document.createElement("a");

      link.download = file?.filename ?? current?.filename ?? fallback ?? title;
      link.href = url;
      link.click();
    },
    [current, title]
  );

  /**
   * Downloads the file again at another quality.
   *
   * The file is fetched again rather than being pretended about, so the button
   * and the file always agree.
   */
  const handleQuality = useCallback(
    async (height: number) => {
      if (!current?.sourceUrl || isRedownloading) {
        return;
      }

      setQuality(height);
      setIsRedownloading(true);

      const toastId = toast.loading(`Downloading at ${height}p…`);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/download`,
          {
            body: JSON.stringify({
              format: current.format,
              quality: height,
              url: current.sourceUrl,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        );
        const data = await response.json();

        if (!response.ok) {
          toast.error(data?.error ?? "The download failed.", { id: toastId });
          return;
        }

        setCurrent({ ...current, ...data });
        setHasEncoded(false);
        toast.success(`Downloaded at ${height}p`, { id: toastId });
      } catch {
        toast.error("The download failed.", { id: toastId });
      } finally {
        setIsRedownloading(false);
      }
    },
    [current, isRedownloading]
  );

  /**
   * Converts the downloaded audio to MP3, in the browser.
   */
  const handleMp3 = useCallback(async () => {
    if (!mp3Source) {
      return;
    }

    setIsEncoding(true);
    setEncodeProgress(0);
    const toastId = toast.loading("Converting to MP3 in your browser…");

    try {
      const encoded = await encodeAsMp3({
        onProgress: (progress) => setEncodeProgress(progress.progress),
        sourceUrl: mp3Source,
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
  }, [mp3Source, title]);

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

        {totalBytes ? (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {formatSize(totalBytes)}
          </span>
        ) : null}
      </div>

      {/* Title */}
      <div className="mt-2">
        <p className="truncate text-[12px] font-medium text-foreground/90">
          {title}
        </p>
        {current?.duration ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {formatDuration(current.duration)}
            {current.sourceUrl ? ` · ${hostOf(current.sourceUrl)}` : ""}
          </p>
        ) : null}
      </div>

      {/* Quality */}
      {!isAudio && current?.url && current.sourceUrl ? (
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
                  : "border-border/50 text-muted-foreground hover:text-foreground",
                isRedownloading && "opacity-50"
              )}
              disabled={isRedownloading}
              key={option.value}
              onClick={() => handleQuality(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          {isRedownloading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2.5">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
          disabled={!current?.url}
          onClick={() => handleDownload()}
          type="button"
        >
          <Download className="size-3" />
          {current?.filename ?? "Download"}
        </button>

        {companion ? (
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={!companion.url}
            onClick={() => handleDownload(companion)}
            type="button"
          >
            <Music className="size-3" />
            {companion.filename ?? "Sound track"}
          </button>
        ) : null}

        {canConvertToMp3 ? (
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

      {companion ? (
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-tight text-muted-foreground/70">
          <TriangleAlert className="mt-px size-2.5 shrink-0" />
          This platform publishes the picture and the sound separately, so both
          are here. The sound track is the one to convert.
        </p>
      ) : null}

      {!isAudio && current?.url && !companion ? (
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
