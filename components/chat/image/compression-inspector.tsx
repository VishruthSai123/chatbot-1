"use client";

import {
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CompressionInspectorProps {
  documentId?: string;
  imageSrc: string;
  isComparing: boolean;
  isGuest?: boolean;
  isProcessing: boolean;
  onRequireAuth?: () => void;
  onUpdateImage: (newBase64: string) => void;
  originalSrc: string | null;
  setIsComparing: (val: boolean) => void;
  setIsProcessing: (val: boolean) => void;
}

export const CompressionInspector = memo(function InnerCompressionInspector({
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
    if (isGuest) {
      onRequireAuth?.();
      return;
    }

    if (isProcessing) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/image`,
        {
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
        }
      );

      if (!response.ok) {
        if (response.status === 403) {
          onRequireAuth?.();
          return;
        }

        let errMessage = "Compression failed";
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
    isGuest,
    onRequireAuth,
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
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        {/* Telemetry Stats */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-xs">
              Current size
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-semibold text-foreground text-xs tabular-nums">
                {approxCurrentKb} KB
              </span>
              {savingsPct !== null && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500 border border-emerald-500/20 tabular-nums">
                  -{savingsPct}%
                </span>
              )}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground block text-xs">
              Original size
            </span>
            <span className="text-muted-foreground text-xs font-medium tabular-nums mt-0.5 block">
              {approxOriginalKb} KB
            </span>
          </div>
        </div>

        {/* Target Size Dropdown */}
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-foreground block"
            htmlFor="target-kb-select"
          >
            Target file size
          </label>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2 pr-8 text-xs font-medium text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
              id="target-kb-select"
              onChange={(e) => {
                const val = e.target.value;
                if (val === "custom") {
                  setTargetKb(null);
                  setCustomKbInput("50");
                } else {
                  setTargetKb(Number(val));
                  setCustomKbInput("");
                }
              }}
              value={customKbInput === "" ? String(targetKb ?? 50) : "custom"}
            >
              <option value="20">20 KB (Strict Portal Limit)</option>
              <option value="50">50 KB (Passport / Visa Standard)</option>
              <option value="100">100 KB (Fast Web Load)</option>
              <option value="200">200 KB (Balanced)</option>
              <option value="500">500 KB (High Quality)</option>
              <option value="custom">Custom KB Limit...</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>

          {/* Inline Custom KB input if custom is chosen */}
          {customKbInput !== "" && (
            <div className="pt-1">
              <input
                className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
                onChange={(e) => {
                  setCustomKbInput(e.target.value);
                  const p = Number.parseInt(e.target.value, 10);
                  setTargetKb(p > 0 ? p : null);
                }}
                placeholder="Enter KB target (e.g. 75)..."
                type="number"
                value={customKbInput}
              />
            </div>
          )}
        </div>

        {/* Quality Slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Visual quality</span>
            <span className="text-foreground font-semibold tabular-nums">
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
        </div>

        {/* Output Format */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Format
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            <button
              className={cn(
                "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer",
                format === "jpeg"
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setFormat("jpeg")}
              type="button"
            >
              JPEG
            </button>
            <button
              className={cn(
                "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer",
                format === "webp"
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setFormat("webp")}
              type="button"
            >
              WebP
            </button>
          </div>
        </div>

        {/* Before / After Slider Toggle */}
        {originalSrc ? (
          <button
            className={cn(
              "w-full flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors cursor-pointer",
              isComparing
                ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
                : "border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            onClick={() => setIsComparing(!isComparing)}
            type="button"
          >
            <SlidersHorizontal className="size-3.5" />
            <span>
              {isComparing ? "Exit Comparison" : "Compare with Original"}
            </span>
          </button>
        ) : null}
      </div>

      {/* Footer Actions */}
      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing}
          onClick={handleRecompress}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Compressing...</span>
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              <span>Apply Compression</span>
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
