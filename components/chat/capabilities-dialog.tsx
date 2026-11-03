"use client";

import {
  BookOpenIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  MicIcon,
  NotebookPenIcon,
  SearchIcon,
  TableIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Capability, capabilities } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

/**
 * Everything the app can do, in one panel.
 *
 * The app is a toolkit — eight families of tools — and a blank composer cannot
 * communicate that. This is the map: one row per family, one line of plain
 * language, and examples that can be put straight into the composer.
 *
 * It is deliberately compact: eight rows, no scrolling on a laptop, and every
 * example is a real prompt rather than a category name.
 */

const ICONS = {
  audio: MicIcon,
  "book-open": BookOpenIcon,
  download: DownloadIcon,
  "file-text": FileTextIcon,
  image: ImageIcon,
  notebook: NotebookPenIcon,
  search: SearchIcon,
  table: TableIcon,
} as const;

export function CapabilitiesDialog({
  initialFamily,
  onOpenChange,
  onUseExample,
  open,
}: {
  /** The family to open on, when the panel was opened from its tile. */
  initialFamily?: string;
  onOpenChange?: (open: boolean) => void;
  /** Puts an example into the composer. */
  onUseExample?: (text: string) => void;
  open: boolean;
}) {
  const [selected, setSelected] = useState<string | undefined>(initialFamily);

  // The tile that opened the panel decides which family is shown; with no
  // tile, the first family is shown rather than an empty half-panel.
  const active = useMemo(
    () =>
      capabilities.find((item) => item.id === (selected ?? initialFamily)) ??
      capabilities[0],
    [initialFamily, selected]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What this can do</DialogTitle>
          <DialogDescription>
            Eight families of tools. Pick one to see examples, or just ask in
            your own words — the right tool is chosen for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {capabilities.map((item) => (
              <CapabilityTile
                active={active?.id === item.id}
                capability={item}
                key={item.id}
                onClick={() => setSelected(item.id)}
              />
            ))}
          </div>

          {active ? (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[12px] font-medium text-foreground">
                {active.name}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {active.description}
              </p>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {active.examples.map((example) => (
                  <button
                    className="group flex w-full cursor-pointer items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-border/60 hover:bg-card hover:text-foreground"
                    key={example}
                    onClick={() => {
                      onUseExample?.(example);
                      onOpenChange?.(false);
                    }}
                    type="button"
                  >
                    <span className="mt-0.5 text-muted-foreground/40 group-hover:text-foreground/60">
                      →
                    </span>
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityTile({
  active,
  capability,
  onClick,
}: {
  active: boolean;
  capability: Capability;
  onClick: () => void;
}) {
  const Icon = ICONS[capability.icon];

  return (
    <button
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-foreground/30 bg-muted text-foreground"
          : "border-border/60 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5" />
      <span className="text-[11px] font-medium leading-tight">
        {capability.name}
      </span>
    </button>
  );
}
