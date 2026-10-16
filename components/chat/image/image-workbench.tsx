import {
  ChevronDown,
  Copy,
  Download,
  Lock,
  Maximize2,
  Redo2,
  SlidersHorizontal,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageToolMode } from "@/components/chat/artifact";
import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
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
  { icon: "📐", key: "resize", label: "Resize" },
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
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // Active Tool Mode (defaults to artifact.toolMode or 'compress')
  const [activeToolMode, setActiveToolMode] = useState<ImageToolMode>(
    artifact.toolMode || "compress"
  );
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);

  // Sync when artifact.toolMode changes externally from tool calls
  useEffect(() => {
    if (artifact.toolMode && artifact.toolMode !== activeToolMode) {
      setActiveToolMode(artifact.toolMode);
      setIsInspectorOpen(true);
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

  // ─── Drag-to-Minimize / Gesture State ─────────────────────────────────────────
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartYRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    dragStartYRef.current = e.clientY;
    setIsDragging(true);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (dragStartYRef.current === null) {
      return;
    }
    const deltaY = e.clientY - dragStartYRef.current;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    }
  }, []);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (dragStartYRef.current === null) {
      return;
    }
    const deltaY = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    setIsDragging(false);

    if (deltaY > 35) {
      setIsInspectorOpen(false);
    }
    setDragOffsetY(0);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    dragStartYRef.current = null;
    setIsDragging(false);
    setDragOffsetY(0);
  }, []);

  const dockStartYRef = useRef<number | null>(null);
  const handleDockPointerDown = useCallback((e: React.PointerEvent) => {
    dockStartYRef.current = e.clientY;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const handleDockPointerUp = useCallback((e: React.PointerEvent) => {
    if (dockStartYRef.current === null) {
      return;
    }
    const deltaY = e.clientY - dockStartYRef.current;
    dockStartYRef.current = null;
    if (deltaY < -20) {
      setIsInspectorOpen(true);
    }
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

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

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 0.25, 3)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 0.25, 0.5)),
    []
  );
  const handleResetZoom = useCallback(() => setZoom(1), []);

  // ─── Touch Pinch-to-Zoom & Double-Tap ────────────────────────────────────────
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const lastTapRef = useRef<number>(0);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartDistRef.current = dist;
        touchStartZoomRef.current = zoom;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          // Double tap toggle between 1x and 2x
          setZoom((z) => (z > 1.2 ? 1 : 2));
        }
        lastTapRef.current = now;
      }
    },
    [zoom]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / touchStartDistRef.current;
      const nextZoom = Math.max(
        0.5,
        Math.min(3, touchStartZoomRef.current * ratio)
      );
      setZoom(Number(nextZoom.toFixed(2)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartDistRef.current = null;
  }, []);

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

  const activeToolObj = TOOL_MODES.find((m) => m.key === activeToolMode);

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-hidden">
      {/* ─── Unified Studio Header ──────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-3 backdrop-blur-sm">
        {/* Left: Close Button + Title + Version + Dimensions */}
        <div className="flex items-center gap-2.5 min-w-0">
          <ArtifactCloseButton />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs md:text-sm text-foreground tracking-tight truncate max-w-[130px] sm:max-w-[200px] md:max-w-xs">
                {artifact.title || title || "image.png"}
              </span>
              {(totalVersions ?? 1) > 1 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground shrink-0">
                  v{(currentVersionIndex ?? 0) + 1}/{totalVersions}
                </span>
              )}
            </div>
            {naturalWidth > 0 && naturalHeight > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground truncate leading-none">
                {naturalWidth} × {naturalHeight} px
              </span>
            )}
          </div>
        </div>

        {/* Center: Tool Mode Switcher (Desktop) */}
        <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-muted/30 p-1 border border-border/40">
          {TOOL_MODES.map((mode) => {
            const isActive = activeToolMode === mode.key;
            return (
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer whitespace-nowrap",
                  isActive
                    ? "bg-foreground text-background shadow-xs font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                key={mode.key}
                onClick={() => {
                  handleToolModeChange(mode.key);
                  setIsInspectorOpen(true);
                }}
                type="button"
              >
                <span className="text-xs select-none">{mode.icon}</span>
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: History Undo/Redo, Desktop Zoom, Quick Actions, Inspector Toggle */}
        <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {/* History Undo / Redo */}
          {handleVersionChange && (totalVersions ?? 1) > 1 && (
            <div className="flex items-center gap-0.5 pr-1">
              <button
                className="rounded-lg p-1.5 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={!canUndo}
                onClick={() => handleVersionChange("prev")}
                title="Undo (Previous Version)"
                type="button"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                className="rounded-lg p-1.5 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={!canRedo}
                onClick={() => handleVersionChange("next")}
                title="Redo (Next Version)"
                type="button"
              >
                <Redo2 className="size-3.5" />
              </button>
            </div>
          )}

          {/* Desktop Zoom Controls */}
          <div className="hidden md:flex items-center gap-1 border-l border-border/40 pl-1.5">
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

          {/* Quick Actions: Copy (Desktop), Download */}
          <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
            <button
              className="hidden sm:inline-flex rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
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
              className={cn(
                "hidden md:flex rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors ml-0.5",
                isInspectorOpen && "bg-muted text-foreground"
              )}
              onClick={() => setIsInspectorOpen((prev) => !prev)}
              title={isInspectorOpen ? "Hide Inspector" : "Show Inspector"}
              type="button"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Guest Mode Alert Banner */}
      {isGuest ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3.5 py-1.5 text-xs text-amber-500">
          <div className="flex items-center gap-2">
            <Lock className="size-3.5 shrink-0" />
            <span className="font-medium text-[11px]">
              Guest Mode: Sign in to transform and save your images
            </span>
          </div>
          <button
            className="rounded bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/30 transition-colors cursor-pointer"
            onClick={() => setShowAuthModal(true)}
            type="button"
          >
            Sign In
          </button>
        </div>
      ) : null}

      {/* ─── Main Content: Canvas on Left, Inspector on Right ──────────────── */}
      <div className="relative flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Left: Focused Image Canvas Area */}
        <div
          className="relative flex flex-1 items-center justify-center overflow-auto p-4 bg-zinc-950/40 min-h-[220px]"
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
        >
          {/* Mobile Zoom Pill */}
          <div className="absolute top-3 left-3 z-20 flex md:hidden items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2 py-0.5 shadow-sm backdrop-blur-md text-[10px] font-mono select-none">
            <button
              className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={handleZoomOut}
              type="button"
            >
              -
            </button>
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={handleZoomIn}
              type="button"
            >
              +
            </button>
          </div>

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

          {/* Floating Bottom Pill Navbar (Visible when inspector is minimized) */}
          {!isInspectorOpen && (
            // biome-ignore lint/a11y/noStaticElementInteractions: bottom dock gesture
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: bottom dock gesture
            // biome-ignore lint/a11y/useKeyWithClickEvents: bottom dock gesture
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1 rounded-2xl border border-border/80 bg-card/95 px-3 py-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-black/10 animate-in fade-in slide-in-from-bottom-3 duration-200 cursor-pointer select-none"
              onClick={() => setIsInspectorOpen(true)}
              onPointerDown={handleDockPointerDown}
              onPointerUp={handleDockPointerUp}
            >
              {/* Drag Up Handle Indicator */}
              <div className="w-8 h-1 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors mb-0.5" />
              <div className="flex items-center gap-1">
                {TOOL_MODES.map((mode) => {
                  const isActive = activeToolMode === mode.key;
                  return (
                    <button
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap",
                        isActive
                          ? "bg-foreground text-background shadow-xs font-semibold"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      key={mode.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToolModeChange(mode.key);
                        setIsInspectorOpen(true);
                      }}
                      type="button"
                    >
                      <span className="text-sm select-none">{mode.icon}</span>
                      <span className="text-xs">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right / Bottom: Focused Inspector Panel (Rounded Bottom Sheet on Mobile, Sidebar on Desktop) */}
        <div
          className={cn(
            // Mobile: Bottom Sheet with rounded top edges, border, backdrop blur, shadow, transform
            "absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border-t border-x border-border/70 bg-card/95 backdrop-blur-2xl shadow-[0_-12px_40px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-300 ease-out",
            // Desktop: Sidebar on the right
            "md:relative md:inset-auto md:w-80 lg:w-84 md:rounded-none md:border-t-0 md:border-x-0 md:border-l md:border-border/60 md:bg-card/60 md:shadow-none",
            isInspectorOpen
              ? "translate-y-0 opacity-100 pointer-events-auto max-h-[62vh] md:max-h-none md:h-full"
              : "translate-y-full md:translate-y-0 md:w-0 md:opacity-0 md:overflow-hidden pointer-events-none md:pointer-events-none"
          )}
          style={{
            transform:
              isInspectorOpen && dragOffsetY > 0
                ? `translateY(${dragOffsetY}px)`
                : undefined,
            transition: isDragging ? "none" : undefined,
          }}
        >
          {/* Top Drag Handle (Mobile only - allows dragging down to minimize) */}
          <div
            className="flex md:hidden flex-col items-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
            onPointerCancel={handleDragCancel}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          >
            <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors" />
          </div>

          {/* Mobile Sheet Header with Tool Name and Minimize Action */}
          <div
            className="flex md:hidden items-center justify-between px-4 py-1.5 border-b border-border/40 shrink-0 cursor-grab active:cursor-grabbing select-none"
            onPointerCancel={handleDragCancel}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          >
            <div className="flex items-center gap-2">
              <span className="text-base select-none">
                {activeToolObj?.icon}
              </span>
              <span className="font-semibold text-xs text-foreground tracking-tight">
                {activeToolObj?.label} Settings
              </span>
            </div>
            <button
              className="flex items-center gap-1 rounded-full bg-muted/50 hover:bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setIsInspectorOpen(false);
              }}
              type="button"
            >
              <span>Minimize</span>
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {/* Desktop Sidebar Header */}
          <div className="hidden md:flex items-center justify-between px-3.5 py-2.5 border-b border-border/50 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm select-none">{activeToolObj?.icon}</span>
              <span className="font-semibold text-xs text-foreground tracking-tight">
                {activeToolObj?.label} Settings
              </span>
            </div>
          </div>

          {/* Scrollable Inspector Body */}
          <div className="flex-1 overflow-y-auto">
            {activeToolMode === "compress" && (
              <CompressionInspector
                documentId={documentId || artifact.documentId}
                imageSrc={currentBase64}
                isComparing={isComparing}
                isGuest={isGuest}
                isProcessing={isProcessing}
                onRequireAuth={() => setShowAuthModal(true)}
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
                isGuest={isGuest}
                isProcessing={isProcessing}
                onRequireAuth={() => setShowAuthModal(true)}
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
                isGuest={isGuest}
                isProcessing={isProcessing}
                naturalHeight={naturalHeight}
                naturalWidth={naturalWidth}
                onRequireAuth={() => setShowAuthModal(true)}
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
                isGuest={isGuest}
                isProcessing={isProcessing}
                onRequireAuth={() => setShowAuthModal(true)}
                onUpdateImage={handleUpdateImage}
                originalSrc={originalBase64}
                setIsComparing={setIsComparing}
                setIsProcessing={setIsProcessing}
              />
            )}
          </div>
        </div>
      </div>

      <GuestAuthModal
        featureName={activeToolObj?.label || "Image Studio"}
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
