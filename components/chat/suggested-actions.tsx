"use client";

import {
  BookOpenIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  NotebookPenIcon,
  PresentationIcon,
  SearchIcon,
  TableIcon,
} from "lucide-react";
import { memo, useCallback, useState } from "react";

import { capabilities } from "@/lib/capabilities";
import { type SampleFile, samples } from "@/lib/samples";
import { cn } from "@/lib/utils";

/**
 * The empty state.
 *
 * Eight families, each an icon and a name — nothing to read, everything one
 * click from its examples. The detail lives in the panel those tiles open, so
 * the home screen stays a launcher rather than a brochure.
 *
 * The samples underneath are the other half of the first thirty seconds: a new
 * user has no PDF, no photo and no recording, so every tile would otherwise
 * dead-end at "attach a file".
 */

const ICONS = {
  audio: MicIcon,
  "book-open": BookOpenIcon,
  download: DownloadIcon,
  "file-text": FileTextIcon,
  image: ImageIcon,
  notebook: NotebookPenIcon,
  presentation: PresentationIcon,
  search: SearchIcon,
  table: TableIcon,
} as const;

type SuggestedActionsProps = {
  onShowCapabilities?: (familyId?: string) => void;
  onTrySample?: (sample: SampleFile) => Promise<void>;
};

function PureSuggestedActions({
  onShowCapabilities,
  onTrySample,
}: SuggestedActionsProps) {
  const [busySample, setBusySample] = useState<string | null>(null);

  const handleSample = useCallback(
    async (sample: SampleFile) => {
      if (!onTrySample) {
        return;
      }

      setBusySample(sample.filename);

      try {
        await onTrySample(sample);
      } catch {
        // The upload helper already reports its own failures; nothing useful
        // to add here beyond not leaving the button spinning.
      } finally {
        setBusySample(null);
      }
    },
    [onTrySample]
  );

  return (
    <div className="flex w-full flex-col gap-4" data-testid="suggested-actions">
      {/*
        Three columns: nine families fill a 3×3 square with no orphan. On a
        phone the grid is two wide, so the odd tile out spans the last row
        rather than sitting alone in half of it.
      */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {capabilities.map((capability, index) => {
          const Icon = ICONS[capability.icon];
          const isLast = index === capabilities.length - 1;

          return (
            <button
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-lg border border-border/50 bg-card/30 px-2.5 py-2 text-left transition-colors duration-150 hover:border-border hover:bg-card/80",
                isLast &&
                  capabilities.length % 2 === 1 &&
                  "col-span-2 sm:col-span-1"
              )}
              key={capability.id}
              onClick={() => onShowCapabilities?.(capability.id)}
              type="button"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
              <span className="truncate text-[12px] font-medium text-foreground/90">
                {capability.name}
              </span>
            </button>
          );
        })}
      </div>

      {onTrySample ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="mr-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
            Try
          </span>
          {samples.map((sample) => (
            <button
              aria-label={`Try the sample ${sample.label}`}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50",
                busySample === sample.filename &&
                  "border-border text-foreground"
              )}
              disabled={busySample !== null}
              key={sample.filename}
              onClick={() => handleSample(sample)}
              type="button"
            >
              {busySample === sample.filename ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : null}
              {sample.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) =>
    prevProps.onShowCapabilities === nextProps.onShowCapabilities &&
    prevProps.onTrySample === nextProps.onTrySample
);
