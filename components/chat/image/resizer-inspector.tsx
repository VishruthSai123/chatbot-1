"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  DPI_OPTIONS,
  type DpiOption,
  PHOTO_PRESETS,
  type PhysicalUnit,
  physicalToPixels,
  UNIT_OPTIONS,
} from "@/lib/image/presets";
import { cn } from "@/lib/utils";

interface ResizerInspectorProps {
  documentId?: string;
  imageSrc: string;
  isProcessing: boolean;
  onUpdateImage: (newBase64: string) => void;
  originalSrc: string | null;
  setIsProcessing: (val: boolean) => void;
}

export const ResizerInspector = memo(function InnerResizerInspector({
  documentId,
  imageSrc,
  originalSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
}: ResizerInspectorProps) {
  const [selectedPreset, setSelectedPreset] =
    useState<string>("indian_passport");
  const [width, setWidth] = useState<number>(35);
  const [height, setHeight] = useState<number>(45);
  const [unit, setUnit] = useState<PhysicalUnit>("mm");
  const [dpi, setDpi] = useState<DpiOption>(300);
  const [fit, _setFit] = useState<"cover" | "contain">("cover");

  const handleSelectPreset = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey);
    const found = PHOTO_PRESETS.find((p) => p.key === presetKey);
    if (found) {
      setWidth(found.width);
      setHeight(found.height);
      setUnit(found.unit);
      setDpi(found.dpi);
    }
  }, []);

  const computedPxW = physicalToPixels(width, unit, dpi);
  const computedPxH = physicalToPixels(height, unit, dpi);

  const handleApplyResize = useCallback(async () => {
    if (isProcessing) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch("/api/tools/image", {
        body: JSON.stringify({
          action: "resize_physical",
          documentId,
          image: originalSrc || imageSrc,
          params: {
            dpi,
            fit,
            height,
            quality: 95,
            unit,
            width,
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        let errMessage = "Resize failed";
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
          `Resized photo to ${width}×${height} ${unit} (${data.result.width}×${data.result.height} px)`
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to resize photo");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isProcessing,
    setIsProcessing,
    originalSrc,
    imageSrc,
    documentId,
    width,
    height,
    unit,
    dpi,
    fit,
    onUpdateImage,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrc.startsWith("data:")
      ? imageSrc
      : `data:image/jpeg;base64,${imageSrc}`;
    link.download = `photo-${width}x${height}${unit}-${Date.now()}.jpg`;
    link.click();
    toast.success("Download started");
  }, [imageSrc, width, height, unit]);

  return (
    <div className="flex h-full flex-col justify-between p-4 space-y-4 text-xs">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">📐</span>
            <div>
              <div className="font-semibold text-foreground text-sm tracking-tight">
                Physical Resize & DPI
              </div>
              <div className="text-[11px] text-muted-foreground">
                Official document specifications & print sizing
              </div>
            </div>
          </div>
        </div>

        {/* Official Presets */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Official Photo Presets
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PHOTO_PRESETS.map((preset) => {
              const isActive = selectedPreset === preset.key;
              return (
                <button
                  className={cn(
                    "flex flex-col items-start rounded-md border p-2 text-left transition-colors cursor-pointer",
                    isActive
                      ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                      : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={preset.key}
                  onClick={() => handleSelectPreset(preset.key)}
                  type="button"
                >
                  <span className="text-[11px] font-medium leading-tight">
                    {preset.displayName}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {preset.width}×{preset.height} {preset.unit}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Physical Dimensions */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Dimensions & Unit
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[10px] text-muted-foreground block mb-1">
                WIDTH
              </span>
              <input
                className="w-full rounded-md border border-border/50 bg-background/80 px-2 py-1 text-xs text-foreground focus:border-foreground/50 focus:outline-none"
                min="1"
                onChange={(e) => {
                  setWidth(Number.parseFloat(e.target.value) || 0);
                  setSelectedPreset("custom");
                }}
                step="0.1"
                type="number"
                value={width}
              />
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground block mb-1">
                HEIGHT
              </span>
              <input
                className="w-full rounded-md border border-border/50 bg-background/80 px-2 py-1 text-xs text-foreground focus:border-foreground/50 focus:outline-none"
                min="1"
                onChange={(e) => {
                  setHeight(Number.parseFloat(e.target.value) || 0);
                  setSelectedPreset("custom");
                }}
                step="0.1"
                type="number"
                value={height}
              />
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground block mb-1">
                UNIT
              </span>
              <select
                className="w-full rounded-md border border-border/50 bg-background/80 px-2 py-1 text-xs text-foreground focus:border-foreground/50 focus:outline-none cursor-pointer"
                onChange={(e) => {
                  setUnit(e.target.value as PhysicalUnit);
                  setSelectedPreset("custom");
                }}
                value={unit}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Target DPI */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Resolution (DPI)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {DPI_OPTIONS.map((opt) => (
              <button
                className={cn(
                  "rounded-md border py-1 text-center font-mono text-[11px] transition-colors cursor-pointer",
                  dpi === opt.value
                    ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                key={opt.value}
                onClick={() => setDpi(opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Calculated Output Preview */}
        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 font-mono text-[11px] space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">OUTPUT PIXELS:</span>
            <span className="font-semibold text-foreground">
              {computedPxW} × {computedPxH} px
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">ASPECT RATIO:</span>
            <span className="text-foreground">
              {height > 0 ? (width / height).toFixed(2) : "1.00"} : 1
            </span>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-sm"
          disabled={isProcessing || width <= 0 || height <= 0}
          onClick={handleApplyResize}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Resizing...
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              Apply Physical Resize
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
});
