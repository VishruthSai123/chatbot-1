"use client";

import { Download, Grid3x3, Loader2, Waves } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type RedactMode = "mosaic" | "blur";

interface PixelatorInspectorProps {
  /** Parameters the model applied on the last image tool call; pre-fills the panel. */
  appliedParams?: Record<string, unknown> | null;
  documentId?: string;
  imageSrc: string;
  isGuest?: boolean;
  isProcessing: boolean;
  onRequireAuth?: () => void;
  onUpdateImage: (newBase64: string) => void;
  originalSrc: string | null;
  setIsProcessing: (val: boolean) => void;
}

export const PixelatorInspector = memo(function InnerPixelatorInspector({
  appliedParams,
  documentId,
  imageSrc,
  originalSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
}: PixelatorInspectorProps) {
  const [blockSize, setBlockSize] = useState<number>(16);
  const [mode, setMode] = useState<RedactMode>("mosaic");

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    if (typeof appliedParams.blockSize === "number") {
      setBlockSize(appliedParams.blockSize);
    }
    if (appliedParams.mode === "mosaic" || appliedParams.mode === "blur") {
      setMode(appliedParams.mode);
    }
  }, [appliedParams]);

  const handleRedact = useCallback(async () => {
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
            action: "pixelate",
            documentId,
            image: originalSrc || imageSrc,
            params: { blockSize, format: "png", mode, quality: 95 },
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
        let errMessage = "Redaction failed";
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
        onUpdateImage(data.result.base64);
        toast.success(
          mode === "blur"
            ? `Blurred with a ${blockSize}px radius`
            : `Pixelated with ${blockSize}px blocks`
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to redact image");
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
    blockSize,
    mode,
    onUpdateImage,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrc.startsWith("data:")
      ? imageSrc
      : `data:image/png;base64,${imageSrc}`;
    link.download = `redacted-${Date.now()}.png`;
    link.click();
    toast.success("Download started");
  }, [imageSrc]);

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Redaction style
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            <button
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-center text-[11px] transition-all cursor-pointer",
                mode === "mosaic"
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setMode("mosaic")}
              type="button"
            >
              <Grid3x3 className="size-3.5" />
              Mosaic
            </button>
            <button
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-center text-[11px] transition-all cursor-pointer",
                mode === "blur"
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setMode("blur")}
              type="button"
            >
              <Waves className="size-3.5" />
              Blur
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {mode === "blur" ? "Blur radius" : "Block size"}
            </span>
            <span className="text-foreground font-semibold tabular-nums">
              {blockSize}px
            </span>
          </div>
          <input
            className="w-full accent-foreground cursor-pointer"
            max={64}
            min={2}
            onChange={(e) => setBlockSize(Number.parseInt(e.target.value, 10))}
            step={2}
            type="range"
            value={blockSize}
          />
          <p className="text-[11px] text-muted-foreground">
            Higher values hide more detail — ideal for faces, plates, and ID
            numbers.
          </p>
        </div>

        <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
          Redaction is applied destructively. Use the version history to revert.
        </div>
      </div>

      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing}
          onClick={handleRedact}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Redacting...</span>
            </>
          ) : (
            <>
              <Grid3x3 className="size-3.5" />
              <span>Apply Redaction</span>
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
