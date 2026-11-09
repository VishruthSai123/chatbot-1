"use client";

import { PanelRightOpen } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The consistent way from a result card into the side panel.
 *
 * Cards are a glance; the panel is where the user actually works. Keeping one
 * shared button means every result family offers the same obvious next step.
 */
export function OpenPanelButton({
  className,
  disabled,
  label = "Open panel",
  onClick,
}: {
  className?: string;
  disabled?: boolean;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <PanelRightOpen className="size-3" />
      {label}
    </button>
  );
}
