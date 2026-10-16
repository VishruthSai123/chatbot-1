import {
  Copy,
  Download,
  Maximize2,
  Redo2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageToolMode } from "@/components/chat/artifact";
import { useArtifact } from "@/hooks/use-artifact";
import { cn } from "@/lib/utils";
import { BeforeAfterSlider } from "../before-after-slider";
import { BackgroundRemovalInspector } from "./background-removal-inspector";
import { CompressionInspector } from "./compression-inspector";
import { type CropBox, CropInspector } from "./crop-inspector";
import { ResizerInspector } from "./resizer-inspector";

interface ImageWorkbenchProps {
  content: string; // base64 string or dataUrl
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  isInline?: boolean;
  onSaveContent?: (newBase64: string, debounce: boolean) => void;
  title: string;
  totalVersions?: number;
}

const TOOL_MODES: {
  key: ImageToolMode;
  label: string;
  icon: string;
}[] = [
  { icon: "🗜️", key: "compress", label: "Compress" },
  { icon: "📐", key: "resize", label: "Resize (DPI)" },
  { icon: "✂️", key: "crop", label: "Crop" },
  { icon: "✨", key: "remove_bg", label: "Remove BG" },
];

export const ImageWorkbench = memo(function InnerImageWorkbench({
  title,
  content,
  documentId,
  isInline: _isInline = false,
  onSaveContent,
  currentVersionIndex = 0,
  handleVersionChange,
  totalVersions = 1,
}: ImageWorkbenchProps) {
  const { artifact, setArtifact } = useArtifact();

  // Active Tool Mode (defaults to artifact.toolMode or 'compress')
  const [activeToolMode, setActiveToolMode] = useState<ImageToolMode>(
    artifact.toolMode || "compress"
  );

  // Sync when artifact.toolMode changes externally from tool calls
  useEffect(() => {
    if (artifact.toolMode && artifact.toolMode !== activeToolMode) {
      setActiveToolMode(artifact.toolMode);
    }
  }, [artifact.toolMode, activeToolMode]);

  const handleToolModeChange = useCallback(
    (mode: ImageToolMode) => {
      setActiveToolMode(mode);
      setArtifact((prev) => ({
        ...prev,
        toolMode: mode,
      }));
    },
    [setArtifact]
  );

  // ─── Image State ─────────────────────────────────────────────────────────────
  const [currentBase64, setCurrentBase64] = useState<string>(content);
  const [originalBase64, setOriginalBase64] = useState<string | null>(null);
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);

  // Sync with incoming content changes
  useEffect(() => {
    if (content && content !== currentBase64) {
      setCurrentBase64(content);
    }
  }, [content, currentBase64]);

  // Set original reference on first load
  useEffect(() => {
    if (content && !originalBase64) {
      setOriginalBase64(content);
    }
  }, [content, originalBase64]);

  const formatSrc = useCallback((str: string | null) => {
    if (!str) {
      return "";
    }
    if (
      str.startsWith("http://") ||
      str.startsWith("https://") ||
      str.startsWith("data:")
    ) {
      return str;
    }
    return `data:image/png;base64,${str}`;
  }, []);

  // Measure natural dimensions
  useEffect(() => {
    if (!currentBase64) {
      return;
    }
    const img = new Image();
    img.src = formatSrc(currentBase64);
    img.onload = () => {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
    };
  }, [currentBase64, formatSrc]);

  // ─── Viewport Zoom & Pan State ───────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isComparing, setIsComparing] = useState<boolean>(false);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleResetZoom = () => setZoom(1);

  // ─── Crop Box State ──────────────────────────────────────────────────────────
  const [cropBox, setCropBox] = useState<CropBox>({
    height: 80,
    width: 80,
    x: 10,
    y: 10,
  });
  const [selectedAspect, setSelectedAspect] = useState<string>("free");
  const [cropDragMode, setCropDragMode] = useState<string | null>(null);
  const cropStartRef = useRef<{
    clientX: number;
    clientY: number;
    initialBox: CropBox;
  }>({
    clientX: 0,
    clientY: 0,
    initialBox: { height: 80, width: 80, x: 10, y: 10 },
  });
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const handleCropMouseDown = (e: React.MouseEvent, mode: string) => {
    e.stopPropagation();
    e.preventDefault();
    setCropDragMode(mode);
    cropStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialBox: { ...cropBox },
    };
  };

  useEffect(() => {
    if (!cropDragMode) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const container = imageContainerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();

      const deltaXPct =
        ((e.clientX - cropStartRef.current.clientX) / rect.width) * 100;
      const deltaYPct =
        ((e.clientY - cropStartRef.current.clientY) / rect.height) * 100;
      const init = cropStartRef.current.initialBox;

      if (cropDragMode === "move") {
        const nextX = Math.max(
          0,
          Math.min(100 - init.width, init.x + deltaXPct)
        );
        const nextY = Math.max(
          0,
          Math.min(100 - init.height, init.y + deltaYPct)
        );
        setCropBox((prev) => ({ ...prev, x: nextX, y: nextY }));
      } else if (cropDragMode === "se") {
        const nextW = Math.max(
          10,
          Math.min(100 - init.x, init.width + deltaXPct)
        );
        const nextH = Math.max(
          10,
          Math.min(100 - init.y, init.height + deltaYPct)
        );
        setCropBox((prev) => ({ ...prev, height: nextH, width: nextW }));
      } else if (cropDragMode === "nw") {
        const nextX = Math.max(
          0,
          Math.min(init.x + init.width - 10, init.x + deltaXPct)
        );
        const nextY = Math.max(
          0,
          Math.min(init.y + init.height - 10, init.y + deltaYPct)
        );
        const nextW = init.width - (nextX - init.x);
        const nextH = init.height - (nextY - init.y);
        setCropBox({ height: nextH, width: nextW, x: nextX, y: nextY });
      }
    };

    const handleMouseUp = () => {
      setCropDragMode(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [cropDragMode]);

  const canUndo = (currentVersionIndex ?? 0) > 0;
  const canRedo = (currentVersionIndex ?? 0) < (totalVersions ?? 1) - 1;

  const handleCopy = useCallback(() => {
    if (!currentBase64) {
      return;
    }
    try {
      const src = formatSrc(currentBase64);
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            toast.success("Image copied to clipboard!");
          }
        }, "image/png");
      };
    } catch {
      toast.error("Failed to copy image to clipboard");
    }
  }, [currentBase64, formatSrc]);

  const handleDownload = useCallback(() => {
    if (!currentBase64) {
      return;
    }
    const link = document.createElement("a");
    link.href = formatSrc(currentBase64);
    link.download = `superiorai-image-${Date.now()}.png`;
    link.click();
    toast.success("Download started!");
  }, [currentBase64, formatSrc]);

  const handleClose = useCallback(() => {
    setArtifact((prev) => ({ ...prev, isVisible: false }));
  }, [setArtifact]);

  // Image update handler from inspectors
  const handleUpdateImage = useCallback(
    (newBase64: string) => {
      setCurrentBase64(newBase64);
      if (onSaveContent) {
        onSaveContent(newBase64, false);
      }
      setArtifact((prev) => ({
        ...prev,
        content: newBase64,
      }));
    },
    [onSaveContent, setArtifact]
  );

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-hidden">
      {/* ─── Top Contextual Header ────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-3.5 backdrop-blur-sm">
        {/* Tool Mode Indicator & Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {TOOL_MODES.map((mode) => {
            const isActive = activeToolMode === mode.key;
            return (
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer whitespace-nowrap",
                  isActive
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                key={mode.key}
                onClick={() => handleToolModeChange(mode.key)}
                type="button"
              >
                <span className="text-xs select-none">{mode.icon}</span>
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        {/* Dimension, History, Zoom, Copy, Download, Close Controls */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {naturalWidth > 0 && naturalHeight > 0 && (
            <span className="hidden sm:inline-block rounded bg-muted/60 px-2 py-0.5 text-[10px]">
              {naturalWidth} × {naturalHeight} px
            </span>
          )}

          {/* History Undo / Redo */}
          {handleVersionChange && (totalVersions ?? 1) > 1 && (
            <div className="flex items-center gap-0.5 border-l border-border/40 pl-1.5">
              <button
                className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={!canUndo}
                onClick={() => handleVersionChange("prev")}
                title="Undo (Previous Version)"
                type="button"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={!canRedo}
                onClick={() => handleVersionChange("next")}
                title="Redo (Next Version)"
                type="button"
              >
                <Redo2 className="size-3.5" />
              </button>
            </div>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
            <button
              className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer"
              onClick={handleZoomOut}
              title="Zoom Out"
              type="button"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-8 text-center text-[10px] tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer"
              onClick={handleZoomIn}
              title="Zoom In"
              type="button"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer ml-0.5"
              onClick={handleResetZoom}
              title="Fit to Screen"
              type="button"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>

          {/* Quick Actions: Copy, Download, Close */}
          <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
            <button
              className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
              onClick={handleCopy}
              title="Copy Image to Clipboard"
              type="button"
            >
              <Copy className="size-3.5" />
            </button>
            <button
              className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
              onClick={handleDownload}
              title="Download Image"
              type="button"
            >
              <Download className="size-3.5" />
            </button>
            <button
              className="rounded p-1 hover:bg-destructive/20 hover:text-destructive cursor-pointer transition-colors ml-0.5"
              onClick={handleClose}
              title="Close Workbench"
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Main Content: Canvas on Left, Inspector on Right ──────────────── */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Left: Focused Image Canvas Area */}
        <div className="relative flex flex-1 items-center justify-center overflow-auto p-4 bg-zinc-950/40">
          {isComparing && originalBase64 ? (
            <div className="size-full max-h-[75vh] flex items-center justify-center">
              <BeforeAfterSlider
                afterLabel="Processed Photo"
                afterSrc={formatSrc(currentBase64)}
                beforeLabel="Original Photo"
                beforeSrc={formatSrc(originalBase64)}
                className="max-h-[70vh] rounded-lg shadow-lg border border-border/50"
              />
            </div>
          ) : (
            <div
              className="relative flex items-center justify-center transition-transform duration-100 select-none"
              ref={imageContainerRef}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
              }}
            >
              {/* Subtle Checkerboard Backplate for Transparency */}
              <div
                className="relative rounded-lg shadow-md border border-border/40 overflow-hidden"
                style={{
                  backgroundColor: "#09090b",
                  backgroundImage: `
                    linear-gradient(45deg, #18181b 25%, transparent 25%),
                    linear-gradient(-45deg, #18181b 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #18181b 75%),
                    linear-gradient(-45deg, transparent 75%, #18181b 75%)
                  `,
                  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                  backgroundSize: "16px 16px",
                }}
              >
                {/* biome-ignore lint/performance/noImgElement: dynamic base64 preview */}
                <img
                  alt={title || "Processed photo"}
                  className="max-h-[70vh] max-w-full object-contain pointer-events-none"
                  src={formatSrc(currentBase64)}
                />

                {/* Interactive Crop Box Overlay (when Crop tool is active) */}
                {activeToolMode === "crop" && (
                  // biome-ignore lint/a11y/noStaticElementInteractions: canvas crop overlay
                  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: canvas crop overlay
                  <div
                    className="absolute border-2 border-emerald-400 bg-emerald-500/10 cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
                    onMouseDown={(e) => handleCropMouseDown(e, "move")}
                    style={{
                      height: `${cropBox.height}%`,
                      left: `${cropBox.x}%`,
                      top: `${cropBox.y}%`,
                      width: `${cropBox.width}%`,
                    }}
                  >
                    {/* Top-Left Resize Handle */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: crop resize handle */}
                    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: crop resize handle */}
                    <div
                      className="absolute -top-1.5 -left-1.5 size-3 rounded-full bg-emerald-400 border border-zinc-900 cursor-nwse-resize shadow"
                      onMouseDown={(e) => handleCropMouseDown(e, "nw")}
                    />

                    {/* Bottom-Right Resize Handle */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: crop resize handle */}
                    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: crop resize handle */}
                    <div
                      className="absolute -bottom-1.5 -right-1.5 size-3 rounded-full bg-emerald-400 border border-zinc-900 cursor-nwse-resize shadow"
                      onMouseDown={(e) => handleCropMouseDown(e, "se")}
                    />

                    {/* Crop Dimension Tag */}
                    <div className="absolute bottom-1 right-1 rounded bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[9px] text-zinc-200 pointer-events-none">
                      {Math.round((cropBox.width / 100) * naturalWidth)}×
                      {Math.round((cropBox.height / 100) * naturalHeight)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Focused Inspector Panel (Only mounts the active tool) */}
        <div className="w-full md:w-80 shrink-0 border-t md:border-t-0 md:border-l border-border/60 bg-card/40 backdrop-blur-md overflow-y-auto">
          {activeToolMode === "compress" && (
            <CompressionInspector
              documentId={documentId || artifact.documentId}
              imageSrc={currentBase64}
              isComparing={isComparing}
              isProcessing={isProcessing}
              onUpdateImage={handleUpdateImage}
              originalSrc={originalBase64}
              setIsComparing={setIsComparing}
              setIsProcessing={setIsProcessing}
            />
          )}

          {activeToolMode === "resize" && (
            <ResizerInspector
              documentId={documentId || artifact.documentId}
              imageSrc={currentBase64}
              isProcessing={isProcessing}
              onUpdateImage={handleUpdateImage}
              originalSrc={originalBase64}
              setIsProcessing={setIsProcessing}
            />
          )}

          {activeToolMode === "crop" && (
            <CropInspector
              cropBox={cropBox}
              documentId={documentId || artifact.documentId}
              imageSrc={currentBase64}
              isProcessing={isProcessing}
              naturalHeight={naturalHeight}
              naturalWidth={naturalWidth}
              onUpdateImage={handleUpdateImage}
              originalSrc={originalBase64}
              selectedAspect={selectedAspect}
              setCropBox={setCropBox}
              setIsProcessing={setIsProcessing}
              setSelectedAspect={setSelectedAspect}
            />
          )}

          {activeToolMode === "remove_bg" && (
            <BackgroundRemovalInspector
              documentId={documentId || artifact.documentId}
              imageSrc={currentBase64}
              isComparing={isComparing}
              isProcessing={isProcessing}
              onUpdateImage={handleUpdateImage}
              originalSrc={originalBase64}
              setIsComparing={setIsComparing}
              setIsProcessing={setIsProcessing}
            />
          )}
        </div>
      </div>
    </div>
  );
});
