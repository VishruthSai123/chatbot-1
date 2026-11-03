"use client";

import { PresentationIcon } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { useArtifact } from "@/hooks/use-artifact";

/**
 * The slides card.
 *
 * A deck is a document, not a file: the card reports what was made and opens
 * the studio, where it can be previewed, restyled and downloaded.
 */

export type SlidesToolType = "tool-slidesCreate" | "tool-slidesEdit";

export interface SlidesToolOutput {
  deck?: unknown;
  documentId?: string;
  error?: string;
  requiresAuth?: boolean;
  slideCount?: number;
  success?: boolean;
  theme?: string;
  title?: string;
}

export function SlidesToolCard({
  output,
  toolType,
}: {
  output?: SlidesToolOutput;
  toolCallId: string;
  toolType: SlidesToolType;
}) {
  const { setArtifact } = useArtifact();

  const handleOpen = useCallback(async () => {
    if (!output?.documentId) {
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${output.documentId}`
      );
      const versions = await response.json();

      if (!response.ok || !Array.isArray(versions) || versions.length === 0) {
        toast.error("That presentation could not be opened.");
        return;
      }

      const latest = versions.at(-1);

      setArtifact((current) => ({
        ...current,
        content: latest.content ?? "",
        documentId: output.documentId as string,
        isVisible: true,
        kind: "slides",
        status: "idle",
        title: output.title ?? "Presentation",
      }));
    } catch {
      toast.error("That presentation could not be opened.");
    }
  }, [output?.documentId, output?.title, setArtifact]);

  if (output?.error) {
    return (
      <div className="flex w-full max-w-[440px] flex-col gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
        <p className="text-[11px] font-medium text-destructive">Presentation</p>
        <p className="text-[11px] leading-relaxed text-destructive/80">
          {output.error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[440px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <PresentationIcon className="size-3.5 shrink-0 text-zinc-500" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {toolType === "tool-slidesEdit" ? "Slide updated" : "Presentation"}
          </span>
        </div>

        {output?.slideCount ? (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {output.slideCount} slides
          </span>
        ) : null}
      </div>

      <div className="mt-2">
        <p className="truncate text-[12px] font-medium text-foreground/90">
          {output?.title ?? "Presentation"}
        </p>
        {output?.theme ? (
          <p className="mt-0.5 font-mono text-[10px] capitalize text-muted-foreground">
            {output.theme} theme
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2.5">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
          disabled={!output?.documentId}
          onClick={handleOpen}
          type="button"
        >
          <PresentationIcon className="size-3" />
          Open slides
        </button>
      </div>
    </div>
  );
}
