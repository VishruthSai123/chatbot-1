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

import {
  type CardData,
  MorphingCardStack,
} from "@/components/ui/morphing-card-stack";
import { capabilities } from "@/lib/capabilities";
import { type SampleFile, samples } from "@/lib/samples";
import { cn } from "@/lib/utils";

/**
 * The empty state.
 *
 * The nine families are a swipeable card stack: drag the top card left or right
 * to move through them, or switch to the grid to see them all at once. Clicking
 * a card opens the panel that explains it.
 *
 * The samples underneath are the other half of the first thirty seconds: a new
 * user has no PDF, no photo and no recording, so every card would otherwise
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

const CARD_DATA: CardData[] = capabilities.map((capability) => {
  const Icon = ICONS[capability.icon];

  return {
    description: capability.description,
    icon: <Icon className="size-4" />,
    id: capability.id,
    title: capability.name,
  };
});

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
      <MorphingCardStack
        cards={CARD_DATA}
        onCardClick={(card) => onShowCapabilities?.(card.id)}
      />

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
