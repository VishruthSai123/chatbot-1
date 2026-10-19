"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatSupportsAlpha } from "@/lib/image/formats";
import { imageDownloadName, imageSrcToDataUrl } from "@/lib/image/mime";
import { IMAGE_TOOL_ENDPOINT } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";
import { useAlphaGuard, useImageTransparency } from "./alpha-guard";

const FORMAT_OPTIONS = ["jpeg", "png", "webp", "avif", "tiff"] as const;
type OutputFormat = (typeof FORMAT_OPTIONS)[number];

interface ConverterInspectorProps {
  /** Parameters the model applied on the last image tool call; pre-fills the panel. */
  appliedParams?: Record<string, unknown> | null;
  documentId?: string;
  imageSrc: string;
  isGuest?: boolean;
  isProcessing: boolean;
  onRequireAuth?: () => void;
  onUpdateImage: (newBase64: string, persisted?: boolean) => void;
  setIsProcessing: (val: boolean) => void;
  /** Which version of the document is on screen; the server resolves its bytes. */
  versionIndex?: number;
}

export const ConverterInspector = memo(function InnerConverterInspector({
  appliedParams,
  documentId,
  imageSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
  versionIndex,
}: ConverterInspectorProps) {
  const [targetFormat, setTargetFormat] = useState<OutputFormat>("webp");
  const [quality, setQuality] = useState<number>(90);

  const isTransparent = useImageTransparency(imageSrc);
  const { alphaDialog, confirmAlphaLoss } = useAlphaGuard(imageSrc);

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    const requested = appliedParams.targetFormat ?? appliedParams.format;
    if (
      typeof requested === "string" &&
      (FORMAT_OPTIONS as readonly string[]).includes(requested)
    ) {
      setTargetFormat(requested as OutputFormat);
    }
    if (typeof appliedParams.quality === "number") {
      setQuality(appliedParams.quality);
    }
  }, [appliedParams]);

  const approxCurrentKb = Math.round(
    ((imageSrc.length * 3) / 4 -
      (imageSrc.endsWith("==") ? 2 : imageSrc.endsWith("=") ? 1 : 0)) /
      1024
  );

  const handleConvert = useCallback(async () => {
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    if (isProcessing) {
      return;
    }

    if (!(await confirmAlphaLoss(targetFormat))) {
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch(IMAGE_TOOL_ENDPOINT, {
        body: JSON.stringify({
          action: "convert",
          documentId,
          flattenAlpha: isTransparent && targetFormat === "jpeg",
          params: { quality, targetFormat },
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
        let errMessage = "Conversion failed";
        try {
          const errData = await response.json();
          if (errData.requiresAuth) {
            onRequireAuth?.();
            return;
          }
          errMessage = errData.error || errMessage;
        } catch {
          // ignore
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (data.result?.base64) {
        onUpdateImage(data.result.base64, Boolean(data.persisted));
        const finalFormat = (data.result.format ?? targetFormat).toUpperCase();
        toast.success(
          data.transparencyPreserved
            ? `Converted to ${finalFormat} — kept transparent, since JPEG has no alpha channel`
            : `Converted to ${finalFormat} (${Math.round(
                data.result.sizeBytes / 1024
              )} KB)`
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to convert image");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isGuest,
    onRequireAuth,
    isProcessing,
    setIsProcessing,
    documentId,
    quality,
    targetFormat,
    onUpdateImage,
    versionIndex,
    confirmAlphaLoss,
    isTransparent,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrcToDataUrl(imageSrc);
    link.download = imageDownloadName("converted", imageSrc);
    link.click();
    toast.success("Download started");
  }, [imageSrc]);

  const lossy = targetFormat !== "png";

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5">
          <span className="text-muted-foreground block text-xs">
            Current size
          </span>
          <span className="font-semibold text-foreground text-xs tabular-nums">
            {approxCurrentKb} KB
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Output format
          </div>
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            {FORMAT_OPTIONS.map((fmt) => (
              <button
                className={cn(
                  "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer uppercase",
                  targetFormat === fmt
                    ? "bg-foreground text-background font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={fmt}
                onClick={() => setTargetFormat(fmt)}
                type="button"
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {lossy ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Quality</span>
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
        ) : (
          <p className="text-[11px] text-muted-foreground">
            PNG is lossless — transparency is preserved automatically.
          </p>
        )}

        {isTransparent ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {formatSupportsAlpha(targetFormat)
              ? `This image has a transparent background, and ${targetFormat.toUpperCase()} keeps it.`
              : "This image has a transparent background — JPEG would fill it with white."}
          </p>
        ) : null}
      </div>

      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing}
          onClick={handleConvert}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Converting...</span>
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              <span>Convert Format</span>
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

      {alphaDialog}
    </div>
  );
});
