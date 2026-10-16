"use client";

import { Crop, Download, Loader2, RotateCcw } from "lucide-react";
import { memo, useCallback } from "react";
import { toast } from "sonner";
import { CROP_ASPECT_PRESETS } from "@/lib/image/presets";
import { cn } from "@/lib/utils";

export interface CropBox {
  height: number; // percentage 0 - 100
  width: number; // percentage 0 - 100
  x: number; // percentage 0 - 100
  y: number; // percentage 0 - 100
}

interface CropInspectorProps {
  cropBox: CropBox;
  documentId?: string;
  imageSrc: string;
  isProcessing: boolean;
  naturalHeight: number;
  naturalWidth: number;
  onUpdateImage: (newBase64: string) => void;
  originalSrc?: string | null;
  selectedAspect: string;
  setCropBox: (box: CropBox | ((prev: CropBox) => CropBox)) => void;
  setIsProcessing: (val: boolean) => void;
  setSelectedAspect: (aspect: string) => void;
}

export const CropInspector = memo(function InnerCropInspector({
  documentId,
  imageSrc,
  originalSrc: _originalSrc,
  cropBox,
  setCropBox,
  naturalWidth,
  naturalHeight,
  selectedAspect,
  setSelectedAspect,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
}: CropInspectorProps) {
  // Compute pixel dimensions
  const pixelLeft = Math.round((cropBox.x / 100) * naturalWidth);
  const pixelTop = Math.round((cropBox.y / 100) * naturalHeight);
  const pixelWidth = Math.round((cropBox.width / 100) * naturalWidth);
  const pixelHeight = Math.round((cropBox.height / 100) * naturalHeight);

  const handleSelectAspect = useCallback(
    (presetKey: string) => {
      setSelectedAspect(presetKey);
      const preset = CROP_ASPECT_PRESETS.find((p) => p.key === presetKey);
      if (!preset?.ratio || !naturalWidth || !naturalHeight) {
        return;
      }

      // Adjust cropBox height to match aspect ratio based on natural image dimensions
      const imageAspect = naturalWidth / naturalHeight;
      const targetAspect = preset.ratio;

      let newWidthPct = 80;
      let newHeightPct = 80;

      if (targetAspect > imageAspect) {
        newWidthPct = 80;
        newHeightPct = (newWidthPct * imageAspect) / targetAspect;
      } else {
        newHeightPct = 80;
        newWidthPct = (newHeightPct * targetAspect) / imageAspect;
      }

      setCropBox({
        height: Math.min(100, newHeightPct),
        width: Math.min(100, newWidthPct),
        x: Math.max(0, (100 - newWidthPct) / 2),
        y: Math.max(0, (100 - newHeightPct) / 2),
      });
    },
    [naturalWidth, naturalHeight, setCropBox, setSelectedAspect]
  );

  const handleResetCrop = useCallback(() => {
    setCropBox({ height: 80, width: 80, x: 10, y: 10 });
    setSelectedAspect("free");
  }, [setCropBox, setSelectedAspect]);

  const handleApplyCrop = useCallback(async () => {
    if (isProcessing || !pixelWidth || !pixelHeight) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch("/api/tools/image", {
        body: JSON.stringify({
          action: "crop",
          documentId,
          image: imageSrc,
          params: {
            height: pixelHeight,
            left: pixelLeft,
            top: pixelTop,
            width: pixelWidth,
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        let errMessage = "Crop failed";
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
          `Photo cropped to ${data.result.width}×${data.result.height} px`
        );
        handleResetCrop();
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to crop photo");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isProcessing,
    setIsProcessing,
    imageSrc,
    documentId,
    pixelLeft,
    pixelTop,
    pixelWidth,
    pixelHeight,
    onUpdateImage,
    handleResetCrop,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrc.startsWith("data:")
      ? imageSrc
      : `data:image/jpeg;base64,${imageSrc}`;
    link.download = `cropped-${Date.now()}.jpg`;
    link.click();
    toast.success("Download started");
  }, [imageSrc]);

  return (
    <div className="flex h-full flex-col justify-between p-4 space-y-4 text-xs">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">✂️</span>
            <div>
              <div className="font-semibold text-foreground text-sm tracking-tight">
                Crop & Framing
              </div>
              <div className="text-[11px] text-muted-foreground">
                Aspect ratio locks & rectangular bounds
              </div>
            </div>
          </div>
        </div>

        {/* Aspect Ratio Presets */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Aspect Ratio Lock
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {CROP_ASPECT_PRESETS.map((preset) => {
              const isActive = selectedAspect === preset.key;
              return (
                <button
                  className={cn(
                    "flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                    isActive
                      ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                      : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={preset.key}
                  onClick={() => handleSelectAspect(preset.key)}
                  type="button"
                >
                  <span className="text-[11px] font-medium">
                    {preset.displayName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Coordinates Readout */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Crop Boundary
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 font-mono text-[11px] space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground block text-[10px]">
                  CROP WIDTH
                </span>
                <span className="font-semibold text-foreground">
                  {pixelWidth} px
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">
                  CROP HEIGHT
                </span>
                <span className="font-semibold text-foreground">
                  {pixelHeight} px
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/30 text-[10px]">
              <div>
                <span className="text-muted-foreground">X (LEFT): </span>
                <span className="text-foreground">{pixelLeft} px</span>
              </div>
              <div>
                <span className="text-muted-foreground">Y (TOP): </span>
                <span className="text-foreground">{pixelTop} px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Helper Note */}
        <div className="rounded-md border border-border/30 bg-muted/10 p-2 text-[11px] text-muted-foreground leading-relaxed">
          Tip: Drag the crop box on the image canvas to reposition, or drag its
          corner handle to resize.
        </div>
      </div>

      {/* Footer Actions */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-sm"
          disabled={isProcessing || pixelWidth <= 0 || pixelHeight <= 0}
          onClick={handleApplyCrop}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Cropping...
            </>
          ) : (
            <>
              <Crop className="size-3.5" />
              Apply Crop
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          <button
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            onClick={handleResetCrop}
            type="button"
          >
            <RotateCcw className="size-3.5" />
            Reset Box
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
            onClick={handleDownload}
            type="button"
          >
            <Download className="size-3.5" />
            Download
          </button>
        </div>
      </div>
    </div>
  );
});
