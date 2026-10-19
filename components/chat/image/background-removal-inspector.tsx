"use client";

import {
  Check,
  ChevronDown,
  Crop,
  Download,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { imageDownloadName, imageSrcToDataUrl } from "@/lib/image/mime";
import { IMAGE_TOOL_ENDPOINT } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";

interface BackgroundRemovalInspectorProps {
  /** Parameters the model applied on the last image tool call; pre-fills the panel. */
  appliedParams?: Record<string, unknown> | null;
  documentId?: string;
  imageSrc: string;
  isComparing: boolean;
  isGuest?: boolean;
  isProcessing: boolean;
  onRequireAuth?: () => void;
  onUpdateImage: (newBase64: string, persisted?: boolean) => void;
  originalSrc: string | null;
  setIsComparing: (val: boolean) => void;
  setIsProcessing: (val: boolean) => void;
  /** Which version of the document is on screen; the server resolves its bytes. */
  versionIndex?: number;
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
    appliedParams,
    documentId,
    imageSrc,
    originalSrc,
    onUpdateImage,
    isProcessing,
    setIsProcessing,
    isComparing,
    setIsComparing,
    isGuest,
    onRequireAuth,
    versionIndex,
  }: BackgroundRemovalInspectorProps) {
    const [bgMode, setBgMode] = useState<"transparent" | "solid_color">(
      "transparent"
    );
    const [bgColor, setBgColor] = useState<string>("#ffffff");
    const [edgeSmoothing, setEdgeSmoothing] = useState<number>(25);
    const [autoTrim, setAutoTrim] = useState<boolean>(false);

    // Pre-fill from the values the model applied via chat, when present.
    useEffect(() => {
      if (!appliedParams) {
        return;
      }
      if (
        appliedParams.mode === "transparent" ||
        appliedParams.mode === "solid_color"
      ) {
        setBgMode(appliedParams.mode);
      }
      if (typeof appliedParams.color === "string") {
        setBgColor(appliedParams.color);
      }
      if (typeof appliedParams.edgeSmoothing === "number") {
        setEdgeSmoothing(appliedParams.edgeSmoothing);
      }
      if (typeof appliedParams.autoTrim === "boolean") {
        setAutoTrim(appliedParams.autoTrim);
      }
    }, [appliedParams]);

    const handleProcessBg = useCallback(async () => {
      if (isGuest) {
        onRequireAuth?.();
        return;
      }

      if (isProcessing) {
        return;
      }
      setIsProcessing(true);

      try {
        const response = await fetch(IMAGE_TOOL_ENDPOINT, {
          body: JSON.stringify({
            action: "remove_bg",
            documentId,
            params: {
              autoTrim,
              color: bgColor,
              edgeSmoothing,
              mode: bgMode,
              quality: 95,
            },
            versionIndex,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        if (!response.ok) {
          if (response.status === 403) {
            onRequireAuth?.();
            return;
          }

          let errMessage = "Background removal failed";
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
          onUpdateImage(data.result.base64, Boolean(data.persisted));
          const dimensions =
            typeof data.result.width === "number" &&
            typeof data.result.height === "number"
              ? ` (${data.result.width} × ${data.result.height})`
              : "";
          const framing = autoTrim ? ", cropped to the subject" : "";
          toast.success(
            bgMode === "solid_color"
              ? `Background replaced with ${bgColor}${framing}${dimensions}`
              : `Background removed — saved as a transparent PNG${framing}${dimensions}`
          );
        }
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || "Failed to process background");
      } finally {
        setIsProcessing(false);
      }
    }, [
      isGuest,
      onRequireAuth,
      isProcessing,
      setIsProcessing,
      documentId,
      bgMode,
      bgColor,
      edgeSmoothing,
      autoTrim,
      onUpdateImage,
      versionIndex,
    ]);

    const handleDownload = useCallback(() => {
      if (!imageSrc) {
        return;
      }
      // The removal result is a PNG with an alpha channel, but this inspector also
      // shows whatever version is on screen, so the extension follows the bytes
      // rather than the currently selected mode.
      const link = document.createElement("a");
      link.href = imageSrcToDataUrl(imageSrc);
      link.download = imageDownloadName(`bg-${bgMode}`, imageSrc);
      link.click();
      toast.success("Download started");
    }, [imageSrc, bgMode]);

    return (
      <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
        <div className="space-y-3.5">
          {/* Mode Selector (Segmented Bar) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-foreground">
                Output style
              </div>
              <span className="text-xs font-medium text-muted-foreground rounded bg-muted/60 px-2 py-0.5">
                {bgMode === "transparent" ? "Transparent PNG" : "Solid Color"}
              </span>
            </div>
            <div className="grid grid-cols-2 rounded-lg bg-muted/40 p-0.5 border border-border/50 text-xs font-medium">
              <button
                className={cn(
                  "rounded-md py-1.5 transition-colors cursor-pointer text-center",
                  bgMode === "transparent"
                    ? "bg-foreground text-background shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setBgMode("transparent")}
                type="button"
              >
                Transparent
              </button>
              <button
                className={cn(
                  "rounded-md py-1.5 transition-colors cursor-pointer text-center",
                  bgMode === "solid_color"
                    ? "bg-foreground text-background shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setBgMode("solid_color")}
                type="button"
              >
                Solid Color
              </button>
            </div>
          </div>

          {/* Color Palette (When Solid Color is selected) */}
          {bgMode === "solid_color" && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-foreground block"
                  htmlFor="color-preset-select"
                >
                  Background color
                </label>
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2 pr-8 text-xs font-medium text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
                    id="color-preset-select"
                    onChange={(e) => setBgColor(e.target.value)}
                    value={bgColor}
                  >
                    {QUICK_COLORS.map((c) => (
                      <option key={c.hex} value={c.hex}>
                        {c.label} ({c.hex})
                      </option>
                    ))}
                    {!QUICK_COLORS.some(
                      (c) => c.hex.toLowerCase() === bgColor.toLowerCase()
                    ) && <option value={bgColor}>Custom ({bgColor})</option>}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                </div>
              </div>

              {/* Swatches + Hex Color Input */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5">
                  {QUICK_COLORS.map((c) => {
                    const isSelected =
                      bgColor.toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        className={cn(
                          "size-5 rounded-full border transition-transform cursor-pointer",
                          isSelected
                            ? "ring-2 ring-foreground ring-offset-1 ring-offset-background scale-110"
                            : "border-border/60 opacity-80 hover:opacity-100"
                        )}
                        key={c.hex}
                        onClick={() => setBgColor(c.hex)}
                        style={{ backgroundColor: c.hex }}
                        title={c.label}
                        type="button"
                      />
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    className="size-6 rounded border border-border/50 bg-background cursor-pointer p-0"
                    onChange={(e) => setBgColor(e.target.value)}
                    type="color"
                    value={bgColor}
                  />
                  <input
                    className="w-16 rounded-md border border-border/50 bg-background/80 px-1.5 py-0.5 font-mono text-[11px] text-foreground focus:border-foreground/50 focus:outline-none uppercase text-center"
                    onChange={(e) => setBgColor(e.target.value)}
                    type="text"
                    value={bgColor}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Subject framing and edge character of the native matte */}
          <div className="space-y-2.5 pt-0.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="bg-edge-smoothing"
                >
                  Edge smoothing
                </label>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {edgeSmoothing === 0
                    ? "Crisp"
                    : edgeSmoothing >= 70
                      ? "Soft"
                      : `${edgeSmoothing}%`}
                </span>
              </div>
              <input
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground disabled:opacity-50"
                disabled={isProcessing}
                id="bg-edge-smoothing"
                max={100}
                min={0}
                onChange={(event) =>
                  setEdgeSmoothing(Number(event.target.value))
                }
                step={5}
                type="range"
                value={edgeSmoothing}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Low keeps product and logo edges razor sharp, high blends fine
                detail like hair.
              </p>
            </div>

            <button
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors cursor-pointer",
                autoTrim
                  ? "border-foreground/50 bg-foreground/5 font-medium text-foreground"
                  : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => setAutoTrim((value) => !value)}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <Crop className="size-3.5" />
                Auto-crop to subject
              </span>
              {autoTrim ? (
                <Check className="size-3.5" />
              ) : (
                <span className="size-3.5 rounded-sm border border-border" />
              )}
            </button>
          </div>

          {/* Before / After Toggle */}
          {originalSrc ? (
            <div className="pt-1">
              <button
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                  isComparing
                    ? "border-foreground/50 bg-foreground/10 text-foreground font-semibold"
                    : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setIsComparing(!isComparing)}
                type="button"
              >
                <SlidersHorizontal className="size-3.5" />
                {isComparing ? "Exit Comparison" : "Compare with Original"}
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
                Processing...
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" />
                Apply Background Removal
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
