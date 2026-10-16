"use client";

import { Download, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BackgroundRemovalInspectorProps {
  documentId?: string;
  imageSrc: string;
  isComparing: boolean;
  isProcessing: boolean;
  onUpdateImage: (newBase64: string) => void;
  originalSrc: string | null;
  setIsComparing: (val: boolean) => void;
  setIsProcessing: (val: boolean) => void;
}

const QUICK_COLORS = [
  { hex: "#ffffff", label: "Pure White (Passport)" },
  { hex: "#0066cc", label: "Studio Blue" },
  { hex: "#e2e8f0", label: "Light Grey" },
  { hex: "#f8fafc", label: "Off White" },
  { hex: "#fee2e2", label: "Light Red" },
];

export const BackgroundRemovalInspector = memo(
  function InnerBackgroundRemovalInspector({
    documentId,
    imageSrc,
    originalSrc,
    onUpdateImage,
    isProcessing,
    setIsProcessing,
    isComparing,
    setIsComparing,
  }: BackgroundRemovalInspectorProps) {
    const [bgMode, setBgMode] = useState<"transparent" | "solid_color">(
      "transparent"
    );
    const [bgColor, setBgColor] = useState<string>("#ffffff");

    const handleProcessBg = useCallback(async () => {
      if (isProcessing) {
        return;
      }
      setIsProcessing(true);

      try {
        const response = await fetch("/api/tools/image", {
          body: JSON.stringify({
            action: "remove_bg",
            documentId,
            image: originalSrc || imageSrc,
            params: {
              color: bgColor,
              mode: bgMode,
              quality: 95,
            },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        if (!response.ok) {
          let errMessage = "Background removal failed";
          try {
            const errData = await response.json();
            errMessage = errData.error || errMessage;
          } catch {
            // Ignore parsing error
          }
          throw new Error(errMessage);
        }

        const data = await response.json();
        if (data.result?.base64) {
          onUpdateImage(data.result.base64);
          toast.success(
            bgMode === "solid_color"
              ? `Background backfilled with ${bgColor}`
              : "Background removed with transparent alpha cutout"
          );
        }
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || "Failed to process background");
      } finally {
        setIsProcessing(false);
      }
    }, [
      isProcessing,
      setIsProcessing,
      originalSrc,
      imageSrc,
      documentId,
      bgMode,
      bgColor,
      onUpdateImage,
    ]);

    const handleDownload = useCallback(() => {
      if (!imageSrc) {
        return;
      }
      const isPng = bgMode === "transparent";
      const link = document.createElement("a");
      link.href = imageSrc.startsWith("data:")
        ? imageSrc
        : `data:image/${isPng ? "png" : "jpeg"};base64,${imageSrc}`;
      link.download = `bg-${bgMode}-${Date.now()}.${isPng ? "png" : "jpg"}`;
      link.click();
      toast.success("Download started");
    }, [imageSrc, bgMode]);

    return (
      <div className="flex h-full flex-col justify-between p-4 space-y-4 text-xs">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border/50">
            <div className="flex items-center gap-2">
              <span className="text-base select-none">✨</span>
              <div>
                <div className="font-semibold text-foreground text-sm tracking-tight">
                  Background Removal
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Neural subject segmentation & backfill
                </div>
              </div>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Output Style
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                className={cn(
                  "flex flex-col items-start rounded-md border p-2 text-left transition-colors cursor-pointer",
                  bgMode === "transparent"
                    ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setBgMode("transparent")}
                type="button"
              >
                <span className="text-[11px]">Transparent Cutout</span>
                <span className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  Alpha PNG
                </span>
              </button>
              <button
                className={cn(
                  "flex flex-col items-start rounded-md border p-2 text-left transition-colors cursor-pointer",
                  bgMode === "solid_color"
                    ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setBgMode("solid_color")}
                type="button"
              >
                <span className="text-[11px]">Solid Color Backfill</span>
                <span className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  Passport JPEG
                </span>
              </button>
            </div>
          </div>

          {/* Color Palette (When Solid Color is selected) */}
          {bgMode === "solid_color" && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Background Color
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {QUICK_COLORS.map((c) => {
                  const isSelected =
                    bgColor.toLowerCase() === c.hex.toLowerCase();
                  return (
                    <button
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                        isSelected
                          ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                          : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      key={c.hex}
                      onClick={() => setBgColor(c.hex)}
                      type="button"
                    >
                      <div
                        className="size-4 shrink-0 rounded-full border border-border shadow-sm"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-[11px] flex-1">{c.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {c.hex}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Hex Color */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  className="size-7 rounded border border-border/50 bg-background cursor-pointer"
                  onChange={(e) => setBgColor(e.target.value)}
                  type="color"
                  value={bgColor}
                />
                <input
                  className="flex-1 rounded-md border border-border/50 bg-background/80 px-2.5 py-1 font-mono text-xs text-foreground focus:border-foreground/50 focus:outline-none uppercase"
                  onChange={(e) => setBgColor(e.target.value)}
                  placeholder="#ffffff"
                  type="text"
                  value={bgColor}
                />
              </div>
            </div>
          )}

          {/* Before / After Toggle */}
          {originalSrc ? (
            <div className="pt-1">
              <button
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                  isComparing
                    ? "border-foreground/50 bg-foreground/10 text-foreground font-semibold"
                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setIsComparing(!isComparing)}
                type="button"
              >
                <SlidersHorizontal className="size-3.5" />
                {isComparing
                  ? "Exit Before/After Comparison"
                  : "Compare with Original"}
              </button>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="space-y-2 pt-3 border-t border-border/50">
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-sm"
            disabled={isProcessing}
            onClick={handleProcessBg}
            type="button"
          >
            {isProcessing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Processing Background...
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" />
                Process Background
              </>
            )}
          </button>

          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted cursor-pointer"
            onClick={handleDownload}
            type="button"
          >
            <Download className="size-3.5" />
            Download Photo
          </button>
        </div>
      </div>
    );
  }
);
