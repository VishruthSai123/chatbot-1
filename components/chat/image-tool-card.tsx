"use client";

import {
  Copy,
  Download,
  Lock,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type { ImageToolMode } from "@/components/chat/artifact";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import type { Document } from "@/lib/db/schema";
import { cn, fetcher } from "@/lib/utils";

export type ImageToolType =
  | "tool-imageCompress"
  | "tool-imageResize"
  // Legacy alias: pre-rename persisted messages still use this part type.
  | "tool-imageResizePhysical"
  | "tool-imageCrop"
  | "tool-imageRemoveBg"
  | "tool-imageConvert"
  | "tool-imageUpscaleEnhance"
  | "tool-imagePixelate"
  | "tool-imageOcr";

interface ImageToolCardProps {
  isReadonly?: boolean;
  output?: {
    id?: string;
    message?: string;
    sizeKb?: number;
    pixelDimensions?: string;
    dimensions?: string;
    dpi?: number;
    mode?: string;
    color?: string;
    croppedDimensions?: string;
    format?: string;
    scale?: number;
    blockSize?: number;
    ocrText?: string;
    wordCount?: number;
    error?: string;
    requiresAuth?: boolean;
  };
  toolCallId: string;
  toolType: ImageToolType;
}

const TOOL_CONFIG: Record<
  ImageToolType,
  {
    label: string;
    mode: ImageToolMode;
    icon: string;
  }
> = {
  "tool-imageCompress": {
    icon: "🗜️",
    label: "Compress Photo",
    mode: "compress",
  },
  "tool-imageConvert": {
    icon: "🔁",
    label: "Convert Format",
    mode: "convert",
  },
  "tool-imageCrop": {
    icon: "✂️",
    label: "Crop Photo",
    mode: "crop",
  },
  "tool-imageOcr": {
    icon: "🔎",
    label: "Extract Text (OCR)",
    mode: "ocr",
  },
  "tool-imagePixelate": {
    icon: "🟦",
    label: "Pixelate / Redact",
    mode: "pixelate",
  },
  "tool-imageRemoveBg": {
    icon: "✨",
    label: "Remove Background",
    mode: "remove_bg",
  },
  "tool-imageResize": {
    icon: "📐",
    label: "Resize Photo",
    mode: "resize",
  },
  "tool-imageResizePhysical": {
    icon: "📐",
    label: "Resize Photo",
    mode: "resize",
  },
  "tool-imageUpscaleEnhance": {
    icon: "🔬",
    label: "Upscale & Enhance",
    mode: "upscale",
  },
};

export function ImageToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
  isReadonly,
}: ImageToolCardProps) {
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  const config = TOOL_CONFIG[toolType] ?? {
    icon: "🖼️",
    label: "Image Processing",
    mode: "compress" as ImageToolMode,
  };

  const documentId = output?.id;

  const { data: documents } = useSWR<Document[]>(
    documentId
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${documentId}`
      : null,
    fetcher
  );

  const docRecord = documents?.[0];
  const imageBase64 = docRecord?.content;

  const handleOpenInspector = useCallback(() => {
    if (isReadonly) {
      toast.error("Viewing documents in shared chats is not supported.");
      return;
    }

    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    if (!documentId) {
      return;
    }

    setArtifact((current) => ({
      ...current,
      content: imageBase64 || current.content,
      documentId,
      isVisible: true,
      kind: "image",
      status: "idle",
      title: docRecord?.title || config.label,
      toolMode: config.mode,
    }));
  }, [
    isReadonly,
    isGuest,
    documentId,
    setArtifact,
    imageBase64,
    docRecord?.title,
    config.label,
    config.mode,
  ]);

  const handleRestore = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      if (isGuest) {
        setShowAuthModal(true);
        return;
      }

      if (!imageBase64) {
        toast.error("Image data is still loading...");
        return;
      }

      try {
        setArtifact((current) => ({
          ...current,
          content: imageBase64,
          documentId: documentId || current.documentId,
          isVisible: true,
          kind: "image",
          status: "idle",
          title: docRecord?.title || config.label,
          toolMode: config.mode,
        }));

        if (documentId) {
          await fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${documentId}`,
            {
              body: JSON.stringify({
                content: imageBase64,
                isManualEdit: true,
                kind: "image",
                title: docRecord?.title || config.label,
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            }
          );
        }

        toast.success("Restored image version to canvas");
      } catch (err: any) {
        console.error("Failed to restore image version:", err);
        toast.error("Failed to restore image");
      }
    },
    [
      imageBase64,
      documentId,
      setArtifact,
      docRecord?.title,
      config.label,
      config.mode,
      isGuest,
    ]
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!imageBase64) {
        toast.error("Image data is still loading...");
        return;
      }

      const fmt = (output?.format || "").toLowerCase();
      const isPng =
        fmt === "png" ||
        config.mode === "remove_bg" ||
        config.mode === "pixelate";
      const mime = isPng ? "image/png" : fmt ? `image/${fmt}` : "image/jpeg";
      const ext = isPng ? "png" : fmt || "jpg";
      const link = window.document.createElement("a");
      link.href = imageBase64.startsWith("data:")
        ? imageBase64
        : `data:${mime};base64,${imageBase64}`;
      link.download = `${config.mode}-${Date.now()}.${ext}`;
      link.click();
      toast.success("Download started");
    },
    [imageBase64, config.mode, output?.format]
  );

  const handleCopyOcr = useCallback(async () => {
    if (!output?.ocrText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(output.ocrText);
      toast.success("Extracted text copied to clipboard");
    } catch {
      toast.error("Failed to copy text");
    }
  }, [output?.ocrText]);

  return (
    <div
      className={cn(
        "group relative flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90"
      )}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-sm select-none">{config.icon}</span>
          <span className="text-xs font-semibold text-foreground tracking-tight">
            {config.label}
          </span>
        </div>

        {output?.sizeKb ? (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
            {output.sizeKb} KB
          </span>
        ) : null}
      </div>

      {/* Middle Body Row */}
      <div className="flex items-start gap-3 py-2.5">
        {/* Crisp Thumbnail Button */}
        <button
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-neutral-900 shadow-inner cursor-pointer"
          onClick={handleOpenInspector}
          type="button"
        >
          {imageBase64 ? (
            // biome-ignore lint/performance/noImgElement: dynamic base64 preview
            <img
              alt={config.label}
              className="size-full object-cover"
              src={
                imageBase64.startsWith("data:")
                  ? imageBase64
                  : `data:image/png;base64,${imageBase64}`
              }
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground animate-pulse">
              ...
            </div>
          )}
        </button>

        {/* Details & Telemetry */}
        <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {docRecord?.title || "Processed Photo"}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {output?.pixelDimensions ? (
              <span>{output.pixelDimensions}</span>
            ) : null}
            {output?.croppedDimensions ? (
              <span>{output.croppedDimensions}</span>
            ) : null}
            {output?.dimensions ? (
              <>
                <span>•</span>
                <span>{output.dimensions}</span>
              </>
            ) : null}
            {output?.dpi ? (
              <>
                <span>•</span>
                <span>{output.dpi} DPI</span>
              </>
            ) : null}
            {output?.mode ? (
              <>
                <span>•</span>
                <span className="capitalize">
                  {output.mode.replace("_", " ")}
                </span>
              </>
            ) : null}
          </div>

          {output?.message ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/90">
              {output.message}
            </p>
          ) : null}

          {config.mode === "ocr" && output?.ocrText ? (
            <div className="mt-1 max-h-28 w-full overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {output.ocrText}
            </div>
          ) : null}
        </div>
      </div>

      {/* Guest Mode Blocker Alert or Error */}
      {output?.requiresAuth || (isGuest && output?.error) ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          <div className="flex items-center gap-2">
            <Lock className="size-3.5 shrink-0" />
            <span className="font-medium text-[11px]">
              Guest Mode: Sign in to unlock this feature
            </span>
          </div>
          <button
            className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/30 transition-colors cursor-pointer"
            onClick={() => setShowAuthModal(true)}
            type="button"
          >
            Sign In
          </button>
        </div>
      ) : output?.error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {output.error}
        </div>
      ) : null}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-border/40">
        {config.mode === "ocr" && output?.ocrText ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            onClick={handleCopyOcr}
            title="Copy extracted text to clipboard"
            type="button"
          >
            <Copy className="size-3.5" />
            Copy Text
          </button>
        ) : null}
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          onClick={handleRestore}
          title="Restore this image version to the canvas workbench"
          type="button"
        >
          <RotateCcw className="size-3.5" />
          Restore
        </button>

        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          onClick={handleDownload}
          title="Download processed image"
          type="button"
        >
          <Download className="size-3.5" />
          Download
        </button>

        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-1 text-xs font-medium text-foreground hover:bg-foreground/10 transition-colors cursor-pointer border border-border/50"
          onClick={handleOpenInspector}
          title="Edit image in studio"
          type="button"
        >
          <SlidersHorizontal className="size-3.5" />
          Edit
        </button>
      </div>

      <GuestAuthModal
        featureName={config.label}
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
}
