"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import { toast } from "sonner";
import {
  CROP_ASPECT_PRESETS,
  getPresetByKey,
  pixelsToPhysical,
  type DpiOption,
  type PhysicalUnit,
} from "@/lib/image/presets";
import { BeforeAfterSlider } from "./before-after-slider";
import { ImageControls } from "./image-controls";

interface ImageStudioCanvasProps {
  title: string;
  content: string; // base64 string
  documentId?: string;
  isInline?: boolean;
  onSaveContent?: (newBase64: string, debounce: boolean) => void;
}

interface CropBox {
  x: number; // percentage of image width 0-100
  y: number; // percentage of image height 0-100
  width: number;
  height: number;
}

export const ImageStudioCanvas = memo(function ImageStudioCanvas({
  title,
  content,
  documentId,
  isInline = false,
  onSaveContent,
}: ImageStudioCanvasProps) {
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
  }, [content]);

  // Keep original reference on first load
  useEffect(() => {
    if (content && !originalBase64) {
      setOriginalBase64(content);
    }
  }, [content, originalBase64]);

  // Read natural image dimensions
  useEffect(() => {
    if (!currentBase64) return;
    const img = new Image();
    img.src = currentBase64.startsWith("data:")
      ? currentBase64
      : `data:image/png;base64,${currentBase64}`;
    img.onload = () => {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
    };
  }, [currentBase64]);

  // ─── Viewport Zoom & Pan State ───────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  // ─── Studio Controls State ───────────────────────────────────────────────────
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [physicalWidth, setPhysicalWidth] = useState<number>(35);
  const [physicalHeight, setPhysicalHeight] = useState<number>(45);
  const [unit, setUnit] = useState<PhysicalUnit>("mm");
  const [dpi, setDpi] = useState<DpiOption>(300);

  // Background Removal
  const [bgMode, setBgMode] = useState<"transparent" | "solid_color">("transparent");
  const [bgColor, setBgColor] = useState<string>("#ffffff");

  // Cropping State
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [cropAspect, setCropAspect] = useState<string>("free");
  const [cropBox, setCropBox] = useState<CropBox>({
    x: 10,
    y: 10,
    width: 80,
    height: 80,
  });
  const [cropDragMode, setCropDragMode] = useState<string | null>(null);
  const cropStartRef = useRef<{ clientX: number; clientY: number; initialBox: CropBox }>({
    clientX: 0,
    clientY: 0,
    initialBox: { x: 0, y: 0, width: 0, height: 0 },
  });

  // Comparison & Execution
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingLabel, setProcessingLabel] = useState<string>("");
  const [showDrawer, setShowDrawer] = useState<boolean>(true);

  // ─── Preset Handler ──────────────────────────────────────────────────────────
  const handleSelectPreset = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey);
    if (!presetKey) return;
    const preset = getPresetByKey(presetKey);
    if (preset) {
      setPhysicalWidth(preset.width);
      setPhysicalHeight(preset.height);
      setUnit(preset.unit);
      setDpi(preset.dpi);
    }
  }, []);

  // ─── API Tool Invocation ─────────────────────────────────────────────────────
  const executeImageAction = useCallback(
    async (action: string, params: any, label: string) => {
      if (isProcessing) return;
      setIsProcessing(true);
      setProcessingLabel(label);

      try {
        const response = await fetch("/api/tools/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            image: currentBase64,
            documentId,
            title,
            params,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Operation failed");
        }

        const data = await response.json();
        const newBase64 = data.result.base64;

        setCurrentBase64(newBase64);
        if (onSaveContent) {
          onSaveContent(newBase64, false);
        }

        toast.success(`${label} completed successfully!`);
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || `Failed to ${label.toLowerCase()}`);
      } finally {
        setIsProcessing(false);
        setProcessingLabel("");
      }
    },
    [isProcessing, currentBase64, documentId, title, onSaveContent]
  );

  // ─── Action Handlers ─────────────────────────────────────────────────────────
  const handleApplyPhysicalResize = useCallback(() => {
    executeImageAction(
      "resize_physical",
      {
        width: physicalWidth,
        height: physicalHeight,
        unit,
        dpi,
        fit: "cover",
      },
      `Resize to ${physicalWidth}×${physicalHeight} ${unit}`
    );
  }, [executeImageAction, physicalWidth, physicalHeight, unit, dpi]);

  const handleRemoveBg = useCallback(() => {
    executeImageAction(
      "remove_bg",
      {
        mode: bgMode,
        color: bgColor,
      },
      bgMode === "solid_color" ? `Backfill Background (${bgColor})` : "Remove Background"
    );
  }, [executeImageAction, bgMode, bgColor]);

  const handleRotateCW = useCallback(() => {
    executeImageAction("rotate", { degrees: 90 }, "Rotate 90° Clockwise");
  }, [executeImageAction]);

  const handleRotateCCW = useCallback(() => {
    executeImageAction("rotate", { degrees: 270 }, "Rotate 90° Counter-Clockwise");
  }, [executeImageAction]);

  const handleFlipH = useCallback(() => {
    executeImageAction("rotate", { flipHorizontal: true }, "Flip Horizontal");
  }, [executeImageAction]);

  const handleFlipV = useCallback(() => {
    executeImageAction("rotate", { flipVertical: true }, "Flip Vertical");
  }, [executeImageAction]);

  const handleCompress50Kb = useCallback(() => {
    executeImageAction(
      "compress",
      { targetSizeKb: 50, quality: 75 },
      "Compress to ≤ 50 KB"
    );
  }, [executeImageAction]);

  const handleResetToOriginal = useCallback(() => {
    if (originalBase64) {
      setCurrentBase64(originalBase64);
      if (onSaveContent) {
        onSaveContent(originalBase64, false);
      }
      setIsComparing(false);
      toast.success("Reset to original image");
    }
  }, [originalBase64, onSaveContent]);

  // ─── Interactive Crop Handlers ───────────────────────────────────────────────
  const handleToggleCrop = useCallback(() => {
    setIsCropping((prev) => !prev);
    setCropBox({ x: 10, y: 10, width: 80, height: 80 });
  }, []);

  const handleCancelCrop = useCallback(() => {
    setIsCropping(false);
  }, []);

  const handleApplyCrop = useCallback(() => {
    if (!naturalWidth || !naturalHeight) return;

    // Convert percentage crop box to actual pixel coordinates
    const left = Math.round((cropBox.x / 100) * naturalWidth);
    const top = Math.round((cropBox.y / 100) * naturalHeight);
    const width = Math.round((cropBox.width / 100) * naturalWidth);
    const height = Math.round((cropBox.height / 100) * naturalHeight);

    executeImageAction(
      "crop",
      { left, top, width, height },
      `Crop (${width}×${height} px)`
    );
    setIsCropping(false);
  }, [cropBox, naturalWidth, naturalHeight, executeImageAction]);

  // ─── Crop Drag & Resize Logic ────────────────────────────────────────────────
  const handleCropMouseDown = (e: React.MouseEvent, mode: string) => {
    e.stopPropagation();
    setCropDragMode(mode);
    cropStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialBox: { ...cropBox },
    };
  };

  useEffect(() => {
    if (!cropDragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = viewportRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      const deltaXPct = ((e.clientX - cropStartRef.current.clientX) / rect.width) * 100;
      const deltaYPct = ((e.clientY - cropStartRef.current.clientY) / rect.height) * 100;
      const init = cropStartRef.current.initialBox;

      if (cropDragMode === "move") {
        const nextX = Math.max(0, Math.min(100 - init.width, init.x + deltaXPct));
        const nextY = Math.max(0, Math.min(100 - init.height, init.y + deltaYPct));
        setCropBox((prev) => ({ ...prev, x: nextX, y: nextY }));
      } else if (cropDragMode === "se") {
        const nextW = Math.max(10, Math.min(100 - init.x, init.width + deltaXPct));
        const nextH = Math.max(10, Math.min(100 - init.y, init.height + deltaYPct));
        setCropBox((prev) => ({ ...prev, width: nextW, height: nextH }));
      } else if (cropDragMode === "nw") {
        const nextX = Math.max(0, Math.min(init.x + init.width - 10, init.x + deltaXPct));
        const nextY = Math.max(0, Math.min(init.y + init.height - 10, init.y + deltaYPct));
        const nextW = init.width - (nextX - init.x);
        const nextH = init.height - (nextY - init.y);
        setCropBox({ x: nextX, y: nextY, width: nextW, height: nextH });
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

  // ─── Panning Handlers ────────────────────────────────────────────────────────
  const handleViewportMouseDown = (e: React.MouseEvent) => {
    if (isCropping) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    };
  };

  useEffect(() => {
    if (!isPanning) return;
    const handleMouseMove = (e: MouseEvent) => {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    };
    const handleMouseUp = () => setIsPanning(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning, pan]);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
  };

  // Image source strings
  const imageSrc = useMemo(() => {
    if (!currentBase64) return "";
    return currentBase64.startsWith("data:")
      ? currentBase64
      : `data:image/png;base64,${currentBase64}`;
  }, [currentBase64]);

  const originalSrc = useMemo(() => {
    if (!originalBase64) return "";
    return originalBase64.startsWith("data:")
      ? originalBase64
      : `data:image/png;base64,${originalBase64}`;
  }, [originalBase64]);

  // Physical dimension string for badge
  const physicalReadout = useMemo(() => {
    if (!naturalWidth || !naturalHeight) return null;
    const wMm = pixelsToPhysical(naturalWidth, "mm", dpi);
    const hMm = pixelsToPhysical(naturalHeight, "mm", dpi);
    return `${wMm} × ${hMm} mm @ ${dpi} DPI`;
  }, [naturalWidth, naturalHeight, dpi]);

  return (
    <div
      className={cn(
        "relative flex w-full flex-col overflow-hidden bg-neutral-950 font-sans",
        isInline ? "h-[360px]" : "h-[calc(100dvh-60px)]"
      )}
    >
      {/* ─── Top Studio Info Bar ───────────────────────────────────────── */}
      <div className="z-10 flex items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-xs text-white tracking-wide">
            {title || "Image Studio"}
          </span>
          {naturalWidth > 0 && (
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-mono text-neutral-300">
              {naturalWidth} × {naturalHeight} px
            </span>
          )}
          {physicalReadout && (
            <span className="hidden sm:inline-block rounded bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 text-[11px] font-mono text-sky-300">
              {physicalReadout}
            </span>
          )}
        </div>

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-300">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.2))}
            className="rounded p-1 hover:bg-neutral-800 text-neutral-400 hover:text-white"
            title="Zoom Out"
          >
            －
          </button>
          <span className="w-12 text-center font-mono text-[11px]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(5, z + 0.2))}
            className="rounded p-1 hover:bg-neutral-800 text-neutral-400 hover:text-white"
            title="Zoom In"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="ml-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] hover:text-white"
          >
            Fit (100%)
          </button>
          <button
            type="button"
            onClick={() => setShowDrawer((prev) => !prev)}
            className="ml-2 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-sky-300 hover:bg-neutral-700"
          >
            {showDrawer ? "Hide Tools" : "Show Tools"}
          </button>
        </div>
      </div>

      {/* ─── Main Workspace (Viewport + Sidebar Drawer) ────────────────── */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Canvas / Viewport Area */}
        <div
          ref={viewportRef}
          onMouseDown={handleViewportMouseDown}
          onWheel={handleWheel}
          className={cn(
            "relative flex-1 overflow-hidden select-none",
            isPanning ? "cursor-grabbing" : isCropping ? "cursor-crosshair" : "cursor-grab"
          )}
          style={{
            backgroundImage:
              "radial-gradient(#262626 1px, transparent 1px), radial-gradient(#171717 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 10px 10px",
          }}
        >
          {isComparing && originalSrc ? (
            /* Split Before/After Comparison View */
            <div className="flex h-full w-full items-center justify-center p-6">
              <BeforeAfterSlider
                beforeSrc={originalSrc}
                afterSrc={imageSrc}
                beforeLabel="Original"
                afterLabel="Processed"
                className="max-h-[80%] max-w-[85%]"
              />
            </div>
          ) : (
            /* Standard Interactive Viewport */
            <div
              className="absolute transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                top: "10%",
                left: "10%",
                right: "10%",
                bottom: "10%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="relative inline-block shadow-2xl">
                {/* Checkerboard backdrop for transparent cutouts */}
                <div
                  className="absolute inset-0 rounded-lg pointer-events-none"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg, #1f1f1f 25%, transparent 25%), linear-gradient(-45deg, #1f1f1f 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f1f1f 75%), linear-gradient(-45deg, transparent 75%, #1f1f1f 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                  }}
                />

                <picture>
                  <img
                    src={imageSrc}
                    alt={title}
                    draggable={false}
                    className="relative z-0 max-h-[70vh] max-w-[70vw] rounded-lg object-contain"
                  />
                </picture>

                {/* ─── Interactive Crop Box Overlay ─────────────────────── */}
                {isCropping && (
                  <div
                    className="absolute z-20 border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
                    style={{
                      left: `${cropBox.x}%`,
                      top: `${cropBox.y}%`,
                      width: `${cropBox.width}%`,
                      height: `${cropBox.height}%`,
                    }}
                  >
                    {/* Drag Move Handle Area */}
                    <div
                      onMouseDown={(e) => handleCropMouseDown(e, "move")}
                      className="absolute inset-0 cursor-move"
                    >
                      {/* Rule of Thirds Grid Lines */}
                      <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                      <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                      <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                      <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                    </div>

                    {/* Corner Handles */}
                    <div
                      onMouseDown={(e) => handleCropMouseDown(e, "nw")}
                      className="absolute -top-1.5 -left-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border border-sky-500 bg-white"
                    />
                    <div
                      onMouseDown={(e) => handleCropMouseDown(e, "se")}
                      className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border border-sky-500 bg-white"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right Controls Drawer ───────────────────────────────────── */}
        {showDrawer && (
          <div className="z-10 w-80 overflow-y-auto border-l border-neutral-800 bg-neutral-950/95 backdrop-blur">
            <ImageControls
              selectedPreset={selectedPreset}
              onSelectPreset={handleSelectPreset}
              width={physicalWidth}
              height={physicalHeight}
              onWidthChange={setPhysicalWidth}
              onHeightChange={setPhysicalHeight}
              unit={unit}
              onUnitChange={setUnit}
              dpi={dpi}
              onDpiChange={setDpi}
              onApplyPhysicalResize={handleApplyPhysicalResize}
              bgMode={bgMode}
              onBgModeChange={setBgMode}
              bgColor={bgColor}
              onBgColorChange={setBgColor}
              onRemoveBg={handleRemoveBg}
              cropAspect={cropAspect}
              onCropAspectChange={setCropAspect}
              isCropping={isCropping}
              onToggleCrop={handleToggleCrop}
              onApplyCrop={handleApplyCrop}
              onCancelCrop={handleCancelCrop}
              onRotateCW={handleRotateCW}
              onRotateCCW={handleRotateCCW}
              onFlipH={handleFlipH}
              onFlipV={handleFlipV}
              onCompress50Kb={handleCompress50Kb}
              hasOriginal={Boolean(originalBase64 && originalBase64 !== currentBase64)}
              isComparing={isComparing}
              onToggleCompare={() => setIsComparing((prev) => !prev)}
              onResetToOriginal={handleResetToOriginal}
              isProcessing={isProcessing}
              processingLabel={processingLabel}
            />
          </div>
        )}
      </div>
    </div>
  );
});
