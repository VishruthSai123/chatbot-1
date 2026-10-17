"use client";

import {
  ChevronDown,
  Crop,
  Crosshair,
  Download,
  Loader2,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { memo, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  aspectRatioInPercent,
  boxForAspect,
  type CropBox,
  fullCropBox,
} from "@/lib/image/crop-box";
import { CROP_ASPECT_PRESETS } from "@/lib/image/presets";

interface CropInspectorProps {
  /** Parameters the model applied on the last image tool call; pre-fills the panel. */
  appliedParams?: Record<string, unknown> | null;
  cropBox: CropBox;
  documentId?: string;
  imageSrc: string;
  isGuest?: boolean;
  isProcessing: boolean;
  naturalHeight: number;
  naturalWidth: number;
  onRequireAuth?: () => void;
  onUpdateImage: (newBase64: string) => void;
  originalSrc?: string | null;
  selectedAspect: string;
  setCropBox: (box: CropBox | ((prev: CropBox) => CropBox)) => void;
  setIsProcessing: (val: boolean) => void;
  setSelectedAspect: (aspect: string) => void;
}

export const CropInspector = memo(function InnerCropInspector({
  appliedParams,
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
  isGuest,
  onRequireAuth,
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
      setCropBox(
        boxForAspect(
          aspectRatioInPercent({
            naturalHeight,
            naturalWidth,
            ratio: preset?.ratio ?? null,
          })
        )
      );
    },
    [naturalHeight, naturalWidth, setCropBox, setSelectedAspect]
  );

  const currentAspectK = aspectRatioInPercent({
    naturalHeight,
    naturalWidth,
    ratio:
      CROP_ASPECT_PRESETS.find((p) => p.key === selectedAspect)?.ratio ?? null,
  });

  const handleResetCrop = useCallback(() => {
    setSelectedAspect("free");
    setCropBox(boxForAspect(null));
  }, [setCropBox, setSelectedAspect]);

  const handleFullFrame = useCallback(() => {
    setSelectedAspect("free");
    setCropBox(fullCropBox());
  }, [setCropBox, setSelectedAspect]);

  const handleCenterCrop = useCallback(() => {
    setCropBox(boxForAspect(currentAspectK));
  }, [currentAspectK, setCropBox]);

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    const aspect = appliedParams.aspectRatio;
    const hasPreset =
      typeof aspect === "string" &&
      CROP_ASPECT_PRESETS.some((p) => p.key === aspect && p.ratio !== null);
    if (hasPreset && typeof aspect === "string") {
      handleSelectAspect(aspect);
      return;
    }
    const { left, top, width, height } = appliedParams;
    if (
      typeof left === "number" &&
      typeof top === "number" &&
      typeof width === "number" &&
      typeof height === "number" &&
      naturalWidth > 0 &&
      naturalHeight > 0
    ) {
      setSelectedAspect("free");
      setCropBox({
        height: Math.min(100, (height / naturalHeight) * 100),
        width: Math.min(100, (width / naturalWidth) * 100),
        x: Math.max(0, (left / naturalWidth) * 100),
        y: Math.max(0, (top / naturalHeight) * 100),
      });
    }
  }, [
    appliedParams,
    handleSelectAspect,
    naturalHeight,
    naturalWidth,
    setCropBox,
    setSelectedAspect,
  ]);

  const handleApplyCrop = useCallback(async () => {
    if (isGuest) {
      onRequireAuth?.();
      return;
    }

    if (isProcessing || !pixelWidth || !pixelHeight) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/image`,
        {
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
        }
      );

      if (!response.ok) {
        if (response.status === 403) {
          onRequireAuth?.();
          return;
        }

        let errMessage = "Crop failed";
        try {
          const errData = await response.json();
          if (errData.requiresAuth) {
            onRequireAuth?.();
            return;
          }
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
    isGuest,
    onRequireAuth,
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
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        {/* Aspect Ratio Lock Dropdown */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              className="text-xs font-medium text-foreground block"
              htmlFor="aspect-select"
            >
              Aspect ratio lock
            </label>
            <span className="text-xs font-medium text-muted-foreground rounded bg-muted/60 px-2 py-0.5 tabular-nums">
              {pixelWidth}×{pixelHeight} px
            </span>
          </div>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2 pr-8 text-xs font-medium text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
              id="aspect-select"
              onChange={(e) => handleSelectAspect(e.target.value)}
              value={selectedAspect}
            >
              {CROP_ASPECT_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.displayName}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
          {/* Touch guidance — the crop frame on the canvas is fully draggable */}
          <p className="text-[11px] leading-relaxed text-muted-foreground md:hidden">
            Drag a corner or edge to resize, drag inside the box to move it, and
            pinch outside the box to zoom.
          </p>
        </div>

        {/* Crop Boundary Telemetry */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">
            Crop dimensions
          </div>
          <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-xs space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground block text-xs">
                  Width
                </span>
                <span className="font-semibold text-foreground text-xs tabular-nums">
                  {pixelWidth} px
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">
                  Height
                </span>
                <span className="font-semibold text-foreground text-xs tabular-nums">
                  {pixelHeight} px
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border/30 text-xs">
              <div>
                <span className="text-muted-foreground">Offset X: </span>
                <span className="text-foreground font-medium tabular-nums">
                  {pixelLeft} px
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Offset Y: </span>
                <span className="text-foreground font-medium tabular-nums">
                  {pixelTop} px
                </span>
              </div>
            </div>
          </div>
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
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleResetCrop}
            type="button"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
          <button
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleFullFrame}
            type="button"
          >
            <Maximize2 className="size-3.5" />
            Full
          </button>
          <button
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleCenterCrop}
            type="button"
          >
            <Crosshair className="size-3.5" />
            Center
          </button>
          <button
            aria-label="Download current image"
            className="flex cursor-pointer items-center justify-center rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-foreground transition-colors hover:bg-muted"
            onClick={handleDownload}
            title="Download current image"
            type="button"
          >
            <Download className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
