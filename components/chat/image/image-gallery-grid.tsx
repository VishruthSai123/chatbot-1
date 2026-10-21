"use client";

import {
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { ImageCollectionItem } from "@/lib/image/ref";
import { formatBytes } from "@/lib/storage/limits";
import { cn } from "@/lib/utils";

export interface ImageGalleryGridProps {
  activeId?: string;
  isProcessing?: boolean;
  items: ImageCollectionItem[];
  onBatchCompress?: (selectedIds: string[]) => void;
  onBatchConvertWebP?: (selectedIds: string[]) => void;
  onBatchToPdf?: (selectedIds: string[]) => void;
  onClearSelection: () => void;
  onCopyItem?: (item: ImageCollectionItem) => void;
  onDownloadItem?: (item: ImageCollectionItem) => void;
  onFocusImage: (item: ImageCollectionItem, index: number) => void;
  onSelectAll: () => void;
  onToggleSelect: (documentId: string) => void;
  selectedIds: Set<string>;
}

const GalleryCard = memo(function InnerGalleryCard({
  index,
  item,
  isSelected,
  onCopy,
  onDownload,
  onFocus,
  onToggle,
}: {
  index: number;
  item: ImageCollectionItem;
  isSelected: boolean;
  onCopy?: (item: ImageCollectionItem) => void;
  onDownload?: (item: ImageCollectionItem) => void;
  onFocus: (item: ImageCollectionItem, index: number) => void;
  onToggle: (documentId: string) => void;
}) {
  const [hasError, setHasError] = useState(false);
  const src = item.thumbUrl || item.url;
  const formatLabel = item.format
    ? item.format.replace("image/", "").toUpperCase()
    : null;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card/60 transition-all duration-200 overflow-hidden select-none",
        isSelected
          ? "border-foreground ring-2 ring-foreground/80 shadow-md"
          : "border-border/60 hover:border-foreground/40 hover:shadow-sm"
      )}
    >
      {/* Main Clickable Area */}
      <button
        aria-label={`Open image ${index + 1}: ${item.filename || item.title || "image"}`}
        className="block w-full cursor-pointer text-left"
        onClick={() => onFocus(item, index)}
        type="button"
      >
        {/* Thumbnail Aspect Container */}
        <div className="relative aspect-4/3 w-full overflow-hidden bg-muted/20 flex items-center justify-center">
          {/* Transparency checkerboard background */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-25 dark:opacity-15 [background-image:linear-gradient(45deg,#888_25%,transparent_25%),linear-gradient(-45deg,#888_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#888_75%),linear-gradient(-45deg,transparent_75%,#888_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0]"
          />

          {src && !hasError ? (
            // biome-ignore lint/performance/noImgElement: signed external storage URLs
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: image load fallback handler
            <img
              alt={item.filename || item.title || `Image ${index + 1}`}
              className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
              decoding="async"
              loading="lazy"
              onError={() => setHasError(true)}
              src={src}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground p-4 text-center">
              <ImageIcon className="size-8 stroke-[1.5] text-muted-foreground/60" />
              <span className="text-[11px] font-mono">No Preview</span>
            </div>
          )}
        </div>

        {/* Card Info Footer */}
        <div className="flex flex-col border-t border-border/50 bg-card/40 p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-foreground tracking-tight">
              {item.filename || item.title || `image-${index + 1}`}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              #{index + 1}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5 text-[10px] font-mono text-muted-foreground">
            <span>
              {item.width && item.height
                ? `${item.width} × ${item.height}`
                : "Ready"}
            </span>
            {item.sizeBytes !== undefined && item.sizeBytes > 0 ? (
              <span>{formatBytes(item.sizeBytes)}</span>
            ) : null}
          </div>
        </div>
      </button>

      {/* Selection Checkbox (Top Left) */}
      <button
        aria-label={isSelected ? "Deselect item" : "Select item"}
        aria-pressed={isSelected}
        className={cn(
          "absolute top-2 left-2 z-10 transition-opacity p-0.5",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(item.documentId);
        }}
        type="button"
      >
        <div
          className={cn(
            "flex size-5 items-center justify-center rounded-md border shadow-xs transition-colors cursor-pointer",
            isSelected
              ? "bg-foreground border-foreground text-background"
              : "bg-background/90 border-border/80 hover:bg-background text-transparent backdrop-blur-xs"
          )}
        >
          <Check className="size-3 stroke-[3]" />
        </div>
      </button>

      {/* Format & Dimensions Badges (Top Right) */}
      <div className="absolute top-2 right-2 z-10 pointer-events-none flex items-center gap-1">
        {formatLabel ? (
          <span className="rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-foreground/90 backdrop-blur-xs shadow-xs border border-border/40">
            {formatLabel}
          </span>
        ) : null}
      </div>

      {/* Hover Action Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-background/30 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-foreground text-background px-2.5 py-1 text-xs font-medium shadow-md hover:bg-foreground/90 transition-transform active:scale-95 cursor-pointer"
          onClick={() => onFocus(item, index)}
          title="Inspect / Edit"
          type="button"
        >
          <Eye className="size-3.5" />
          <span>Edit</span>
        </button>
        {onDownload ? (
          <button
            className="pointer-events-auto flex size-7 items-center justify-center rounded-lg bg-background/90 text-foreground border border-border/60 shadow-md hover:bg-background transition-transform active:scale-95 cursor-pointer"
            onClick={() => onDownload(item)}
            title="Download"
            type="button"
          >
            <Download className="size-3.5" />
          </button>
        ) : null}
        {onCopy ? (
          <button
            className="pointer-events-auto flex size-7 items-center justify-center rounded-lg bg-background/90 text-foreground border border-border/60 shadow-md hover:bg-background transition-transform active:scale-95 cursor-pointer"
            onClick={() => onCopy(item)}
            title="Copy"
            type="button"
          >
            <Copy className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
});

export const ImageGalleryGrid = memo(function InnerImageGalleryGrid({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onFocusImage,
  onDownloadItem,
  onCopyItem,
  onBatchConvertWebP,
  onBatchCompress,
  onBatchToPdf,
  isProcessing = false,
}: ImageGalleryGridProps) {
  const selectedCount = selectedIds.size;
  const isAllSelected = items.length > 0 && selectedCount === items.length;

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      onClearSelection();
    } else {
      onSelectAll();
    }
  }, [isAllSelected, onClearSelection, onSelectAll]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20">
          <ImageIcon className="size-7 stroke-[1.5] text-muted-foreground/60" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No images found</p>
          <p className="text-xs text-muted-foreground">
            Upload or generate images to inspect and edit them in the
            collection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Scrollable Grid Container */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <GalleryCard
              index={index}
              isSelected={selectedIds.has(item.documentId)}
              item={item}
              key={item.documentId || `${item.storageKey}-${index}`}
              onCopy={onCopyItem}
              onDownload={onDownloadItem}
              onFocus={onFocusImage}
              onToggle={onToggleSelect}
            />
          ))}
        </div>
      </div>

      {/* Floating Batch Action Bar */}
      {selectedCount > 0 ? (
        <div className="pointer-events-none absolute bottom-4 inset-x-0 flex justify-center px-4 z-20">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border/80 bg-background/95 px-3.5 py-2 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Selection info & Select All toggle */}
            <div className="flex items-center gap-1.5 pr-1 border-r border-border/60">
              <span className="font-semibold text-foreground tabular-nums">
                {selectedCount}
              </span>
              <span className="text-muted-foreground">selected</span>
              <button
                className="ml-1 text-[11px] text-muted-foreground hover:text-foreground font-medium underline underline-offset-2 cursor-pointer transition-colors"
                onClick={handleToggleSelectAll}
                type="button"
              >
                {isAllSelected ? "Deselect all" : "Select all"}
              </button>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1">
              {onBatchToPdf ? (
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors cursor-pointer disabled:opacity-40"
                  disabled={isProcessing}
                  onClick={() => onBatchToPdf(Array.from(selectedIds))}
                  title="Combine selected images into a single PDF document"
                  type="button"
                >
                  <FileText className="size-3.5 text-red-500/90" />
                  <span>Turn into PDF</span>
                </button>
              ) : null}

              {onBatchConvertWebP ? (
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors cursor-pointer disabled:opacity-40"
                  disabled={isProcessing}
                  onClick={() => onBatchConvertWebP(Array.from(selectedIds))}
                  title="Convert selected images to modern WebP format"
                  type="button"
                >
                  <Sparkles className="size-3.5 text-amber-500/90" />
                  <span>WebP</span>
                </button>
              ) : null}

              {onBatchCompress ? (
                <button
                  className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors cursor-pointer disabled:opacity-40"
                  disabled={isProcessing}
                  onClick={() => onBatchCompress(Array.from(selectedIds))}
                  title="Compress selected images for web delivery"
                  type="button"
                >
                  <SlidersHorizontal className="size-3.5 text-sky-500/90" />
                  <span>Compress</span>
                </button>
              ) : null}
            </div>

            {/* Clear Selection Button */}
            <button
              aria-label="Clear selection"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer ml-0.5"
              onClick={onClearSelection}
              title="Clear selection"
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
