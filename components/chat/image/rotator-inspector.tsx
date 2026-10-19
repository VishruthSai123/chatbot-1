"use client";

import {
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { imageDownloadName, imageSrcToDataUrl } from "@/lib/image/mime";
import { IMAGE_TOOL_ENDPOINT } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";
import { useImageTransparency } from "./alpha-guard";

interface RotatorInspectorProps {
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

/** Corner fill offered when an arbitrary angle exposes area the image never had. */
const BACKGROUNDS = ["#ffffff", "#000000", "#e5e7eb", "#1e3a8a"] as const;

/** Angles a quarter-turn button jumps to; free angles stay between these. */
const FULL_TURN = 360;

/** Normalises any angle into [0, 360) so the readout never says -270°. */
function normalise(degrees: number): number {
  return ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

export const RotatorInspector = memo(function InnerRotatorInspector({
  appliedParams,
  documentId,
  imageSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
  versionIndex,
}: RotatorInspectorProps) {
  const [degrees, setDegrees] = useState<number>(0);
  const [flipHorizontal, setFlipHorizontal] = useState<boolean>(false);
  const [flipVertical, setFlipVertical] = useState<boolean>(false);
  const [background, setBackground] = useState<string>(BACKGROUNDS[0]);

  const isTransparent = useImageTransparency(imageSrc);

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    if (typeof appliedParams.degrees === "number") {
      setDegrees(appliedParams.degrees);
    }
    if (typeof appliedParams.flipHorizontal === "boolean") {
      setFlipHorizontal(appliedParams.flipHorizontal);
    }
    if (typeof appliedParams.flipVertical === "boolean") {
      setFlipVertical(appliedParams.flipVertical);
    }
    if (typeof appliedParams.background === "string") {
      setBackground(appliedParams.background);
    }
  }, [appliedParams]);

  const normalised = normalise(degrees);
  const isQuarterTurn = normalised % 90 === 0;
  const isIdentity = normalised === 0 && !(flipHorizontal || flipVertical);

  const handleApply = useCallback(async () => {
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    if (isProcessing) {
      return;
    }
    if (isIdentity) {
      toast.error("Choose a rotation or a flip first");
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch(IMAGE_TOOL_ENDPOINT, {
        body: JSON.stringify({
          action: "rotate",
          documentId,
          params: { background, degrees, flipHorizontal, flipVertical },
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
        let errMessage = "Rotation failed";
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
        toast.success(
          `Photo rotated to ${data.result.width}×${data.result.height} px`
        );
        setDegrees(0);
        setFlipHorizontal(false);
        setFlipVertical(false);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to rotate photo");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isGuest,
    onRequireAuth,
    isProcessing,
    isIdentity,
    setIsProcessing,
    documentId,
    background,
    degrees,
    flipHorizontal,
    flipVertical,
    versionIndex,
    onUpdateImage,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrcToDataUrl(imageSrc);
    link.download = imageDownloadName("rotated", imageSrc);
    link.click();
    toast.success("Download started");
  }, [imageSrc]);

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        {/* Quarter turns */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Turn
          </div>
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            <button
              className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              onClick={() => setDegrees((d) => normalise(d - 90))}
              type="button"
            >
              <RotateCcw className="size-3.5" />
              90° left
            </button>
            <button
              className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              onClick={() => setDegrees((d) => normalise(d + 180))}
              type="button"
            >
              180°
            </button>
            <button
              className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              onClick={() => setDegrees((d) => normalise(d + 90))}
              type="button"
            >
              <RotateCw className="size-3.5" />
              90° right
            </button>
          </div>
        </div>

        {/* Flips */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Flip
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            <button
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-all cursor-pointer",
                flipHorizontal
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setFlipHorizontal((v) => !v)}
              type="button"
            >
              <FlipHorizontal2 className="size-3.5" />
              Horizontal
            </button>
            <button
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-all cursor-pointer",
                flipVertical
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setFlipVertical((v) => !v)}
              type="button"
            >
              <FlipVertical2 className="size-3.5" />
              Vertical
            </button>
          </div>
        </div>

        {/* Free angle */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Angle</span>
            <span className="text-foreground font-semibold tabular-nums">
              {normalised}°
            </span>
          </div>
          <input
            className="w-full accent-foreground cursor-pointer"
            max={359}
            min={0}
            onChange={(e) =>
              setDegrees(Number.parseInt(e.target.value, 10) || 0)
            }
            step={1}
            type="range"
            value={normalised}
          />
          <p className="text-[11px] text-muted-foreground">
            Quarter turns keep every pixel. Any other angle exposes corners.
          </p>
        </div>

        {/* Corner fill — only relevant for a free angle on an opaque photo. */}
        {isQuarterTurn || isTransparent ? null : (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Corner fill
            </div>
            <div className="flex items-center gap-1.5">
              {BACKGROUNDS.map((color) => (
                <button
                  aria-label={`Fill corners with ${color}`}
                  className={cn(
                    "size-6 rounded-md border transition-all cursor-pointer",
                    background === color
                      ? "border-foreground ring-1 ring-foreground"
                      : "border-border/60 hover:border-foreground/50"
                  )}
                  key={color}
                  onClick={() => setBackground(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {background}
              </span>
            </div>
          </div>
        )}

        {isTransparent ? (
          <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Transparent background detected — exposed corners stay transparent.
          </div>
        ) : null}
      </div>

      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing || isIdentity}
          onClick={handleApply}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Rotating...</span>
            </>
          ) : (
            <>
              <RotateCw className="size-3.5" />
              <span>Apply Rotation</span>
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
