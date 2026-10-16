"use client";

import { Download, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CompressionInspectorProps {
  documentId?: string;
  imageSrc: string;
  isComparing: boolean;
  isProcessing: boolean;
  onUpdateImage: (newBase64: string) => void;
  originalSrc: string | null;
  setIsComparing: (val: boolean) => void;
  setIsProcessing: (val: boolean) => void;
}

const PRESET_SIZES = [
  { kb: 50, label: "50 KB (Govt/Portal)" },
  { kb: 100, label: "100 KB" },
  { kb: 200, label: "200 KB" },
  { kb: 500, label: "500 KB" },
];

export const CompressionInspector = memo(function InnerCompressionInspector({
  documentId,
  imageSrc,
  originalSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isComparing,
  setIsComparing,
}: CompressionInspectorProps) {
  const [targetKb, setTargetKb] = useState<number | null>(50);
  const [quality, setQuality] = useState<number>(75);
  const [format, setFormat] = useState<"jpeg" | "webp">("jpeg");
  const [customKbInput, setCustomKbInput] = useState<string>("");

  // Calculate approximate file size from base64
  const approxCurrentKb = Math.round(
    ((imageSrc.length * 3) / 4 -
      (imageSrc.endsWith("==") ? 2 : imageSrc.endsWith("=") ? 1 : 0)) /
      1024
  );

  const approxOriginalKb = originalSrc
    ? Math.round(
        ((originalSrc.length * 3) / 4 -
          (originalSrc.endsWith("==")
            ? 2
            : originalSrc.endsWith("=")
              ? 1
              : 0)) /
          1024
      )
    : approxCurrentKb;

  const handleRecompress = useCallback(async () => {
    if (isProcessing) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch("/api/tools/image", {
        body: JSON.stringify({
          action: "compress",
          documentId,
          image: originalSrc || imageSrc,
          params: {
            format,
            quality,
            targetSizeKb: targetKb || undefined,
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        let errMessage = "Compression failed";
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
        const finalKb = Math.round(data.result.sizeBytes / 1024);
        toast.success(`Compressed photo to ${finalKb} KB`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to compress image");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isProcessing,
    setIsProcessing,
    originalSrc,
    imageSrc,
    documentId,
    quality,
    targetKb,
    format,
    onUpdateImage,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrc.startsWith("data:")
      ? imageSrc
      : `data:image/${format};base64,${imageSrc}`;
    link.download = `compressed-${Date.now()}.${format === "webp" ? "webp" : "jpg"}`;
    link.click();
    toast.success("Download started");
  }, [imageSrc, format]);

  const savingsPct =
    approxOriginalKb > 0 && approxOriginalKb > approxCurrentKb
      ? Math.round(
          ((approxOriginalKb - approxCurrentKb) / approxOriginalKb) * 100
        )
      : null;

  return (
    <div className="flex h-full flex-col justify-between p-4 space-y-4 text-xs">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">🗜️</span>
            <div>
              <div className="font-semibold text-foreground text-sm tracking-tight">
                Compression
              </div>
              <div className="text-[11px] text-muted-foreground">
                Target file size & quality optimization
              </div>
            </div>
          </div>
          {savingsPct !== null && (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
              -{savingsPct}%
            </span>
          )}
        </div>

        {/* Telemetry Stats */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/40 bg-muted/20 p-2.5 font-mono text-[11px]">
          <div>
            <span className="text-muted-foreground block text-[10px]">
              CURRENT SIZE
            </span>
            <span className="font-semibold text-foreground text-xs">
              {approxCurrentKb} KB
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">
              ORIGINAL SIZE
            </span>
            <span className="text-foreground text-xs">
              {approxOriginalKb} KB
            </span>
          </div>
        </div>

        {/* Target Size Presets */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Target File Size (KB)
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_SIZES.map((preset) => {
              const isActive = targetKb === preset.kb && customKbInput === "";
              return (
                <button
                  className={cn(
                    "flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                    isActive
                      ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                      : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={preset.kb}
                  onClick={() => {
                    setTargetKb(preset.kb);
                    setCustomKbInput("");
                  }}
                  type="button"
                >
                  <span className="text-[11px]">{preset.label}</span>
                </button>
              );
            })}
          </div>

          {/* Custom KB Input */}
          <div className="flex items-center gap-2 pt-1">
            <input
              className="flex-1 rounded-md border border-border/50 bg-background/80 px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/50 focus:outline-none"
              onChange={(e) => {
                setCustomKbInput(e.target.value);
                const parsed = Number.parseInt(e.target.value, 10);
                if (parsed > 0) {
                  setTargetKb(parsed);
                } else {
                  setTargetKb(null);
                }
              }}
              placeholder="Custom KB..."
              type="number"
              value={customKbInput}
            />
            {customKbInput ? (
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setCustomKbInput("");
                  setTargetKb(50);
                }}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {/* Quality Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted-foreground uppercase tracking-wider">
              Visual Quality
            </span>
            <span className="font-mono text-foreground font-medium">
              {quality}%
            </span>
          </div>
          <input
            className="w-full accent-foreground cursor-pointer"
            max={100}
            min={10}
            onChange={(e) => setQuality(Number.parseInt(e.target.value, 10))}
            step={5}
            type="range"
            value={quality}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>Smallest File</span>
            <span>Maximum Fidelity</span>
          </div>
        </div>

        {/* Output Format */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Output Format
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className={cn(
                "flex-1 rounded-md border px-2.5 py-1 text-center font-mono text-[11px] transition-colors cursor-pointer",
                format === "jpeg"
                  ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                  : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => setFormat("jpeg")}
              type="button"
            >
              JPEG (Standard)
            </button>
            <button
              className={cn(
                "flex-1 rounded-md border px-2.5 py-1 text-center font-mono text-[11px] transition-colors cursor-pointer",
                format === "webp"
                  ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                  : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => setFormat("webp")}
              type="button"
            >
              WebP (Modern)
            </button>
          </div>
        </div>

        {/* Before / After Slider Toggle */}
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
          onClick={handleRecompress}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Compressing...
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              Re-compress Photo
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
