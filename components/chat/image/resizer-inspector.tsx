"use client";

import { ChevronDown, Download, Loader2, RefreshCw } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import {
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

const DPI_VALUES: DpiOption[] = [72, 150, 300, 600];

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
    if (presetKey === "custom") {
      return;
    }
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
          `Resized to ${width}×${height} ${unit} (${data.result.width}×${data.result.height} px)`
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
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-sm select-none">📐</span>
            <div className="font-semibold text-foreground text-xs tracking-tight">
              Physical Resize
            </div>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground rounded bg-muted/60 px-1.5 py-0.5">
            {width}×{height} {unit}
          </span>
        </div>

        {/* Preset Dropdown */}
        <div className="space-y-1.5">
          <label
            className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block"
            htmlFor="preset-select"
          >
            Document Preset
          </label>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2 pr-8 text-xs font-medium text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
              id="preset-select"
              onChange={(e) => handleSelectPreset(e.target.value)}
              value={selectedPreset}
            >
              <optgroup label="Official Passports & Visas">
                <option value="indian_passport">
                  Indian Passport / OCI (35 × 45 mm)
                </option>
                <option value="us_visa">
                  US Visa & Passport (2 × 2 in / 51 × 51 mm)
                </option>
                <option value="schengen_visa">
                  Schengen Visa (35 × 45 mm)
                </option>
                <option value="uk_visa">
                  UK / Australian Visa (35 × 45 mm)
                </option>
                <option value="pan_card">Indian PAN Card (25 × 35 mm)</option>
                <option value="stamp_size">Stamp Size (20 × 25 mm)</option>
              </optgroup>
              <optgroup label="Standard Prints">
                <option value="photo_4x6">Photo Print (4 × 6 in)</option>
              </optgroup>
              <option value="custom">Custom Dimensions...</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
        </div>

        {/* Dimensions & Unit */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Dimensions & Unit
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                W
              </span>
              <input
                className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
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
              <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                H
              </span>
              <input
                className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-mono text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
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
              <span className="text-[10px] font-mono text-muted-foreground block mb-1">
                UNIT
              </span>
              <div className="relative">
                <select
                  className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5 pr-6 text-xs font-mono text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
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
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* Resolution (DPI) Segmented Bar */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Resolution
          </div>
          <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            {DPI_VALUES.map((val) => {
              const isActive = dpi === val;
              return (
                <button
                  className={cn(
                    "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer",
                    isActive
                      ? "bg-foreground text-background font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={val}
                  onClick={() => setDpi(val)}
                  type="button"
                >
                  {val} DPI
                </button>
              );
            })}
          </div>
        </div>

        {/* Calculated Output Telemetry */}
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 font-mono text-[11px] space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-[10px]">OUTPUT</span>
            <span className="font-semibold text-foreground">
              {computedPxW} × {computedPxH} px
            </span>
          </div>
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-muted-foreground">RATIO</span>
            <span className="text-muted-foreground">
              {height > 0 ? (width / height).toFixed(2) : "1.00"} : 1
            </span>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing || width <= 0 || height <= 0}
          onClick={handleApplyResize}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Resizing...</span>
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              <span>Apply Physical Resize</span>
            </>
          )}
        </button>

        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted cursor-pointer"
          onClick={handleDownload}
          type="button"
        >
          <Download className="size-3.5" />
          <span>Download Photo</span>
        </button>
      </div>
    </div>
  );
});
