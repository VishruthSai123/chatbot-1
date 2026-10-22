"use client";

import {
  Download,
  FileAudio,
  Loader2,
  Pause,
  Play,
  ScrollText,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { decodeAudioRef } from "@/lib/audio/ref";
import {
  buildPeaks,
  extractTimestamps,
  formatTimestamp,
  normalisePeaks,
  toTranscriptBlocks,
  toVtt,
} from "@/lib/audio/waveform";

/**
 * The Audio Studio.
 *
 * A waveform, a transport and a transcript.
 *
 * The waveform is drawn from the *decoded* audio, in the browser, rather than
 * from a server-rendered image: the browser already has to decode the file to
 * play it, and doing the peaks here means the server never touches the samples
 * and a two-hour recording costs nothing to preview.
 *
 * The transcript is written by Gemini with timestamps inline, so every timecode
 * in the text is a link that seeks the player.
 */

export interface AudioStudioProps {
  content: string;
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  title: string;
  totalVersions?: number;
}

/** How many buckets the waveform is reduced to. */
const PEAK_BUCKETS = 600;

export const AudioStudio = memo(function InnerAudioStudio({
  content,
  documentId,
  title,
  totalVersions = 1,
}: AudioStudioProps) {
  const { artifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const ref = decodeAudioRef(content);
  const transcript = ref?.transcript ?? "";
  const segments = extractTimestamps(transcript);
  const blocks = toTranscriptBlocks(segments);

  /**
   * The transcript doubles as the player's caption track.
   *
   * The timecodes are already in the text, so a WebVTT track costs nothing to
   * produce — and it means the recording is readable by anyone who cannot use
   * the transcript panel.
   */
  const captionUrl = useMemo(
    () =>
      URL.createObjectURL(
        new Blob([toVtt(segments) || "WEBVTT\n"], { type: "text/vtt" })
      ),
    [segments]
  );

  useEffect(
    () => () => {
      if (captionUrl) {
        URL.revokeObjectURL(captionUrl);
      }
    },
    [captionUrl]
  );

  /**
   * Decodes the file and reduces it to peaks.
   *
   * `decodeAudioData` is the expensive step, so it happens once per file and the
   * result is kept. A file the browser cannot decode is not an error: the
   * studio still shows the metadata and the transcript, and the audio element
   * plays whatever the browser can manage.
   */
  useEffect(() => {
    if (!documentId) {
      return;
    }

    let cancelled = false;

    const decode = async () => {
      setIsDecoding(true);

      try {
        const response = await fetch(
          `/api/tools/audio?documentId=${encodeURIComponent(documentId)}`
        );

        if (!response.ok) {
          return;
        }

        const { url } = await response.json();

        if (!url || cancelled) {
          return;
        }

        setMediaUrl(url);

        const buffer = await fetch(url).then((result) => result.arrayBuffer());

        if (cancelled) {
          return;
        }

        const context = new AudioContext();
        const decoded = await context.decodeAudioData(buffer);

        if (cancelled) {
          return;
        }

        const samples = decoded.getChannelData(0);
        const reduced = normalisePeaks(buildPeaks(samples, PEAK_BUCKETS));

        setPeaks(reduced);
        setDuration(decoded.duration);
        await context.close();
      } catch (error) {
        console.warn("Could not decode the audio for the waveform:", error);
      } finally {
        if (!cancelled) {
          setIsDecoding(false);
        }
      }
    };

    decode().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  /** Draws the waveform, and the played portion over it. */
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!(canvas && peaks.length > 0)) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 2, 3);

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);

    const barWidth = Math.max(1, width / peaks.length);
    const progress = duration > 0 ? currentTime / duration : 0;

    for (const [index, peak] of peaks.entries()) {
      const x = index * barWidth;
      const barHeight = Math.max(1, peak * height * 0.92);
      const played = index / peaks.length <= progress;

      context.fillStyle = played ? "rgb(24 24 27)" : "rgb(161 161 170)";
      context.fillRect(
        x,
        (height - barHeight) / 2,
        Math.max(1, barWidth - 1),
        barHeight
      );
    }
  }, [currentTime, duration, peaks]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      audio.play().catch((error) => {
        console.warn("Could not start playback:", error);
      });
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = Math.max(0, seconds);
    setCurrentTime(audio.currentTime);
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;

      if (!(canvas && duration > 0)) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;

      seek(ratio * duration);
    },
    [duration, seek]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[220px] truncate text-xs font-semibold tracking-tight text-foreground md:text-sm">
              {ref?.title ?? artifact.title ?? title ?? "Audio"}
            </span>
            <span className="truncate font-mono text-[10px] leading-none text-muted-foreground">
              {duration > 0 ? formatTimestamp(duration) : "Audio"}
              {ref?.format ? ` · ${ref.format}` : ""}
              {totalVersions > 1 ? ` · v${totalVersions}` : ""}
            </span>
          </div>
        </div>

        {mediaUrl ? (
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              const source = `/api/tools/audio/file?documentId=${encodeURIComponent(
                documentId ?? ""
              )}`;

              window.open(source, "_blank", "noopener");
            }}
            type="button"
          >
            <Download className="size-3" />
            Download
          </button>
        ) : null}
      </div>

      {/* Waveform + transport */}
      <div className="shrink-0 border-b border-border/40 p-4">
        {isDecoding ? (
          <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the waveform…
          </div>
        ) : peaks.length === 0 ? (
          <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
            <FileAudio className="size-4" />
            The waveform could not be drawn for this file.
          </div>
        ) : (
          <canvas
            className="h-24 w-full cursor-pointer"
            onClick={handleCanvasClick}
            ref={canvasRef}
          />
        )}

        <div className="mt-2 flex items-center gap-3">
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
            disabled={!mediaUrl}
            onClick={togglePlay}
            type="button"
          >
            {isPlaying ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>

          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
          </span>
        </div>

        {/* The element is what actually plays; it is kept out of the layout. */}
        <audio
          className="hidden"
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={(event) =>
            setCurrentTime(event.currentTarget.currentTime)
          }
          preload="metadata"
          ref={audioRef}
          src={mediaUrl ?? undefined}
        >
          <track
            kind="captions"
            label="Transcript"
            src={captionUrl}
            srcLang="en"
          />
        </audio>
      </div>

      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {transcript ? (
          <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
            {blocks.map((block) => (
              <p
                className="text-[13px] leading-relaxed text-foreground/90"
                key={`${block.timestamp ?? "t"}-${block.text.slice(0, 16)}`}
              >
                {block.timestamp === undefined ? (
                  block.text
                ) : (
                  <>
                    <button
                      className="mr-1.5 cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => seek(block.timestamp ?? 0)}
                      title="Jump to this moment"
                      type="button"
                    >
                      {block.text}
                    </button>
                    {block.text}
                  </>
                )}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <ScrollText className="size-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {isGuest
                ? "Sign in to transcribe this recording."
                : "No transcript yet — ask for one and it will appear here."}
            </p>
          </div>
        )}
      </div>

      <GuestAuthModal
        featureName="Audio Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
