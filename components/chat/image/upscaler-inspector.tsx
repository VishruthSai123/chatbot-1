"use client";

import { Download, Loader2, Sparkles, Wand2 } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type OutputFormat = "jpeg" | "png" | "webp";

interface UpscalerInspectorProps {
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

function ToggleRow({
  label,
  active,
  onToggle,
  icon,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer",
        active
          ? "border-foreground/40 bg-foreground/10 text-foreground font-semibold"
          : "border-border/50 bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      onClick={onToggle}
      type="button"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          active ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-background transition-all",
            active ? "left-3.5" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

export const UpscalerInspector = memo(function InnerUpscalerInspector({
  appliedParams,
  documentId,
  imageSrc,
  originalSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
}: UpscalerInspectorProps) {
  const [scale, setScale] = useState<2 | 4>(2);
  const [sharpen, setSharpen] = useState<boolean>(true);
  const [enhance, setEnhance] = useState<boolean>(false);
  const [format, setFormat] = useState<OutputFormat>("jpeg");

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    if (appliedParams.scale === 2 || appliedParams.scale === 4) {
      setScale(appliedParams.scale);
    }
    if (typeof appliedParams.sharpen === "boolean") {
      setSharpen(appliedParams.sharpen);
    }
    if (typeof appliedParams.enhance === "boolean") {
      setEnhance(appliedParams.enhance);
    }
    if (
      appliedParams.format === "jpeg" ||
      appliedParams.format === "png" ||
      appliedParams.format === "webp"
    ) {
      setFormat(appliedParams.format);
    }
  }, [appliedParams]);

  const handleUpscale = useCallback(async () => {
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
            action: "upscale",
            documentId,
            image: originalSrc || imageSrc,
            params: { enhance, format, quality: 95, scale, sharpen },
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
        let errMessage = "Upscale failed";
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
          `Upscaled ${scale}x to ${data.result.width}×${data.result.height} px`
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to upscale image");
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
    scale,
    sharpen,
    enhance,
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
    const ext = format === "jpeg" ? "jpg" : format;
    link.download = `upscaled-${Date.now()}.${ext}`;
    link.click();
    toast.success("Download started");
  }, [imageSrc, format]);

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Scale factor
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            {([2, 4] as const).map((s) => (
              <button
                className={cn(
                  "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer",
                  scale === s
                    ? "bg-foreground text-background font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={s}
                onClick={() => setScale(s)}
                type="button"
              >
                {s}× upscale
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Enhancement
          </div>
          <div className="space-y-1.5">
            <ToggleRow
              active={sharpen}
              icon={<Sparkles className="size-3.5" />}
              label="Sharpen edges"
              onToggle={() => setSharpen((v) => !v)}
            />
            <ToggleRow
              active={enhance}
              icon={<Wand2 className="size-3.5" />}
              label="Boost brightness & color"
              onToggle={() => setEnhance((v) => !v)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Format
          </div>
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            {(["jpeg", "png", "webp"] as const).map((fmt) => (
              <button
                className={cn(
                  "rounded-md py-1.5 text-center font-mono text-[11px] transition-all cursor-pointer uppercase",
                  format === fmt
                    ? "bg-foreground text-background font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={fmt}
                onClick={() => setFormat(fmt)}
                type="button"
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing}
          onClick={handleUpscale}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Upscaling...</span>
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              <span>Upscale & Enhance</span>
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
