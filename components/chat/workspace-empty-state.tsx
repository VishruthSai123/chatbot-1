"use client";

import {
  FileSpreadsheet,
  FileText,
  ImageIcon,
  NotebookPen,
  PanelRightIcon,
  Search,
} from "lucide-react";

const SURFACES = [
  { icon: FileText, label: "PDFs" },
  { icon: ImageIcon, label: "Images" },
  { icon: FileSpreadsheet, label: "Data" },
  { icon: FileText, label: "Documents" },
  { icon: NotebookPen, label: "Notebooks" },
  { icon: Search, label: "Search" },
] as const;

/**
 * What the side panel shows before anything has been opened.
 *
 * The panel is deliberately available from the header at all times, so this is
 * the first thing a user sees when they open it early. It explains what belongs
 * here instead of showing an empty grey rectangle.
 */
export function WorkspaceEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-muted-foreground shadow-sm">
        <PanelRightIcon className="size-6" />
      </div>

      <h2 className="mt-4 text-sm font-semibold tracking-tight text-foreground">
        Your workspace is ready
      </h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Open a PDF, image, spreadsheet, document, notebook, or search result and
        it will appear here.
      </p>

      <div className="mt-5 flex flex-wrap justify-center gap-1.5">
        {SURFACES.map(({ icon: Icon, label }) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground"
            key={label}
          >
            <Icon className="size-3" />
            {label}
          </span>
        ))}
      </div>

      <p className="mt-6 font-mono text-[10px] text-muted-foreground/60">
        Tip: the panel button in the header opens this workspace anytime.
      </p>
    </div>
  );
}
