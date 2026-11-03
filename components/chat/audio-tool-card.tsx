"use client";

import { AudioLinesIcon, ClockIcon, FileAudioIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { fetcher } from "@/lib/utils";

/**
 * The audio card.
 *
 * Audio had a studio but no card, so a transcription or an inspection happened
 * invisibly: the model said something and the conversation showed nothing.
 * This is the missing surface — what the file is, what was read out of it, and
 * a way into the studio.
 */

export type AudioToolType =
  | "tool-audioInfo"
  | "tool-audioOpen"
  | "tool-audioTranscribe";

export interface AudioToolOutput {
  bitrate?: number;
  channels?: number;
  documentId?: string;
  duration?: number;
  error?: string;
  format?: string;
  requiresAuth?: boolean;
  sampleRate?: number;
  transcript?: string;
}

const TOOL_LABELS: Record<AudioToolType, { label: string; icon: string }> = {
  "tool-audioInfo": { icon: "🎧", label: "Audio details" },
  "tool-audioOpen": { icon: "🎚️", label: "Audio Studio" },
  "tool-audioTranscribe": { icon: "📝", label: "Transcript" },
};

export function AudioToolCard({
  isReadonly,
  output,
  toolType,
}: {
  isReadonly?: boolean;
  output?: AudioToolOutput;
  toolCallId: string;
  toolType: AudioToolType;
}) {
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const config = TOOL_LABELS[toolType] ?? {
    icon: "🎧",
    label: "Audio",
  };

  const documentId = output?.documentId;

  const { data: documents } = useSWR<any[]>(
    documentId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${documentId}`
      : null,
    fetcher
  );

  const docRecord = documents?.at(-1);
  const title = docRecord?.title ?? "Audio";

  const handleOpenStudio = useCallback(() => {
    if (isReadonly) {
      toast.error("Viewing documents in shared chats is not supported.");
      return;
    }

    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    if (!(documentId || docRecord?.content)) {
      return;
    }

    setArtifact((current) => ({
      ...current,
      content: docRecord?.content ?? current.content,
      documentId: documentId ?? current.documentId,
      isVisible: true,
      kind: "audio",
      status: "idle",
      title,
    }));
  }, [docRecord, documentId, isGuest, isReadonly, setArtifact, title]);

  if (output?.error) {
    return (
      <div className="flex w-full max-w-[440px] flex-col gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
        <p className="text-[11px] font-medium text-destructive">
          {config.icon} {config.label}
        </p>
        <p className="text-[11px] leading-relaxed text-destructive/80">
          {output.error}
        </p>
      </div>
    );
  }

  const details = [
    output?.duration ? formatDuration(output.duration) : null,
    output?.format ?? null,
    output?.bitrate ? `${Math.round(output.bitrate / 1000)} kbps` : null,
    output?.sampleRate ? `${Math.round(output.sampleRate / 1000)} kHz` : null,
    output?.channels
      ? `${output.channels} ${output.channels === 1 ? "channel" : "channels"}`
      : null,
  ].filter(Boolean) as string[];

  const transcript = output?.transcript ?? "";
  const transcriptPreview =
    showFullTranscript || transcript.length <= 420
      ? transcript
      : `${transcript.slice(0, 420)}…`;

  return (
    <div className="flex w-full max-w-[440px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileAudioIcon className="size-3.5 shrink-0 text-zinc-500" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
        </div>

        {output?.duration ? (
          <span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            <ClockIcon className="size-2.5" />
            {formatDuration(output.duration)}
          </span>
        ) : null}
      </div>

      <div className="mt-2">
        <p className="truncate text-[12px] font-medium text-foreground/90">
          {title}
        </p>
        {details.length > 0 ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {details.join(" · ")}
          </p>
        ) : null}
      </div>

      {transcript ? (
        <div className="mt-2.5 rounded-md border border-border/50 bg-muted/20 p-2.5">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80">
            {transcriptPreview}
          </p>
          {transcript.length > 420 ? (
            <button
              className="mt-1.5 cursor-pointer text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={() => setShowFullTranscript((value) => !value)}
              type="button"
            >
              {showFullTranscript ? "Show less" : "Show the whole transcript"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2.5">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
          disabled={!documentId}
          onClick={handleOpenStudio}
          type="button"
        >
          <AudioLinesIcon className="size-3" />
          Open in Audio Studio
        </button>
      </div>

      <GuestAuthModal onOpenChange={setShowAuthModal} open={showAuthModal} />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
