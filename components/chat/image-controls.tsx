"use client";

import { memo } from "react";
import cn from "classnames";
import {
  CROP_ASPECT_PRESETS,
  DPI_OPTIONS,
  PHOTO_PRESETS,
  UNIT_OPTIONS,
  type DpiOption,
  type PhotoPreset,
  type PhysicalUnit,
} from "@/lib/image/presets";

interface ImageControlsProps {
  // Preset & Physical Dimensions
  selectedPreset: string;
  onSelectPreset: (presetKey: string) => void;
  width: number;
  height: number;
  onWidthChange: (w: number) => void;
  onHeightChange: (h: number) => void;
  unit: PhysicalUnit;
  onUnitChange: (unit: PhysicalUnit) => void;
  dpi: DpiOption;
  onDpiChange: (dpi: DpiOption) => void;
  onApplyPhysicalResize: () => void;

  // Background Removal
  bgMode: "transparent" | "solid_color";
  onBgModeChange: (mode: "transparent" | "solid_color") => void;
  bgColor: string;
  onBgColorChange: (color: string) => void;
  onRemoveBg: () => void;

  // Crop
  cropAspect: string;
  onCropAspectChange: (aspectKey: string) => void;
  isCropping: boolean;
  onToggleCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;

  // Transforms
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onFlipH: () => void;
  onFlipV: () => void;

  // Compress
  onCompress50Kb: () => void;

  // Compare & Reset
  hasOriginal: boolean;
  isComparing: boolean;
  onToggleCompare: () => void;
  onResetToOriginal: () => void;

  // Global status
  isProcessing: boolean;
  processingLabel?: string;
}

const QUICK_COLORS = [
  { label: "Pure White (Passport)", hex: "#ffffff" },
  { label: "Light Grey", hex: "#e2e8f0" },
  { label: "Off White", hex: "#f8fafc" },
  { label: "Studio Blue", hex: "#0066cc" },
  { label: "Light Red", hex: "#fee2e2" },
];

export const ImageControls = memo(function InnerImageControls({
  selectedPreset,
  onSelectPreset,
  width,
  height,
  onWidthChange,
  onHeightChange,
  unit,
  onUnitChange,
  dpi,
  onDpiChange,
  onApplyPhysicalResize,
  bgMode,
  onBgModeChange,
  bgColor,
  onBgColorChange,
  onRemoveBg,
  cropAspect,
  onCropAspectChange,
  isCropping,
  onToggleCrop,
  onApplyCrop,
  onCancelCrop,
  onRotateCW,
  onRotateCCW,
  onFlipH,
  onFlipV,
  onCompress50Kb,
  hasOriginal,
  isComparing,
  onToggleCompare,
  onResetToOriginal,
  isProcessing,
  processingLabel,
}: ImageControlsProps) {
  return (
    <div className="flex flex-col gap-4 p-4 text-xs text-neutral-300">
      {/* ─── Processing Banner ────────────────────────────────────────── */}
      {isProcessing && (
        <div className="flex items-center gap-2.5 rounded-lg border border-sky-500/30 bg-sky-950/40 px-3.5 py-2.5 text-sky-200">
          <svg className="h-4 w-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium">{processingLabel || "Processing image..."}</span>
        </div>
      )}

      {/* ─── Official Photo Presets ───────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center justify-between font-semibold text-neutral-200">
          <span>Official Visa & Document Presets</span>
          <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Sharp DPI</span>
        </div>

        <select
          value={selectedPreset}
          onChange={(e) => onSelectPreset(e.target.value)}
          disabled={isProcessing}
          className="rounded-md border border-neutral-700 bg-neutral-800/90 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="">Custom Dimensions...</option>
          {PHOTO_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.displayName} ({p.width}×{p.height} {p.unit} @ {p.dpi} DPI)
            </option>
          ))}
        </select>

        {/* Dimension inputs + Unit + DPI */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <div>
            <label className="text-[10px] text-neutral-400 block mb-0.5">Width</label>
            <input
              type="number"
              step="any"
              value={width || ""}
              onChange={(e) => onWidthChange(Number.parseFloat(e.target.value) || 0)}
              disabled={isProcessing}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-neutral-400 block mb-0.5">Height</label>
            <input
              type="number"
              step="any"
              value={height || ""}
              onChange={(e) => onHeightChange(Number.parseFloat(e.target.value) || 0)}
              disabled={isProcessing}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-neutral-400 block mb-0.5">Unit</label>
            <select
              value={unit}
              onChange={(e) => onUnitChange(e.target.value as PhysicalUnit)}
              disabled={isProcessing}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-neutral-400 block mb-0.5">DPI</label>
            <select
              value={dpi}
              onChange={(e) => onDpiChange(Number.parseInt(e.target.value, 10) as DpiOption)}
              disabled={isProcessing}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              {DPI_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={onApplyPhysicalResize}
          disabled={isProcessing || !width || !height}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Resize to Physical ({width}×{height} {unit} @ {dpi} DPI)
        </button>
      </div>

      {/* ─── Background Removal (Neural ONNX) ─────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center justify-between font-semibold text-neutral-200">
          <span>AI Background Remover</span>
          <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 uppercase">
            Native Zero-Cost
          </span>
        </div>

        {/* Mode selection */}
        <div className="grid grid-cols-2 gap-1.5 rounded-md bg-neutral-800/80 p-0.5">
          <button
            type="button"
            onClick={() => onBgModeChange("transparent")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] font-medium transition",
              bgMode === "transparent"
                ? "bg-neutral-700 text-white shadow-sm"
                : "text-neutral-400 hover:text-white"
            )}
          >
            Transparent Alpha
          </button>
          <button
            type="button"
            onClick={() => onBgModeChange("solid_color")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] font-medium transition",
              bgMode === "solid_color"
                ? "bg-neutral-700 text-white shadow-sm"
                : "text-neutral-400 hover:text-white"
            )}
          >
            Solid Backfill
          </button>
        </div>

        {/* Solid color swatches if solid_color mode */}
        {bgMode === "solid_color" && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center gap-1.5">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.label}
                  onClick={() => onBgColorChange(c.hex)}
                  className={cn(
                    "h-6 w-6 rounded-full border-2 transition",
                    bgColor.toLowerCase() === c.hex.toLowerCase()
                      ? "border-sky-400 scale-110 shadow-sm"
                      : "border-neutral-600 hover:scale-105"
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <input
                type="color"
                value={bgColor}
                onChange={(e) => onBgColorChange(e.target.value)}
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Custom color"
              />
            </div>
            <span className="text-[10px] text-neutral-400">
              Selected Color: <code className="text-white font-mono">{bgColor}</code>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onRemoveBg}
          disabled={isProcessing}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          {bgMode === "solid_color"
            ? `Extract & Fill with ${bgColor}`
            : "Remove Background (Transparent)"}
        </button>
      </div>

      {/* ─── Interactive Crop & Aspect Ratio ─────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center justify-between font-semibold text-neutral-200">
          <span>Crop & Aspect Ratio</span>
          {isCropping && (
            <span className="rounded bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
              Active Drag
            </span>
          )}
        </div>

        {/* Aspect presets */}
        <div className="grid grid-cols-4 gap-1">
          {CROP_ASPECT_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onCropAspectChange(p.key)}
              className={cn(
                "rounded border px-1.5 py-1 text-[10px] font-medium transition",
                cropAspect === p.key
                  ? "border-sky-500 bg-sky-950/60 text-sky-200"
                  : "border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:text-white"
              )}
            >
              {p.displayName}
            </button>
          ))}
        </div>

        {isCropping ? (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onApplyCrop}
              disabled={isProcessing}
              className="flex-1 rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              Apply Crop
            </button>
            <button
              type="button"
              onClick={onCancelCrop}
              disabled={isProcessing}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-neutral-300 hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleCrop}
            disabled={isProcessing}
            className="mt-0.5 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700"
          >
            Start Interactive Crop
          </button>
        )}
      </div>

      {/* ─── Quick Transforms & Compression ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        {/* Rotation & Flip */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
          <span className="font-semibold text-neutral-200">Rotate & Flip</span>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={onRotateCCW}
              title="Rotate 90° CCW"
              disabled={isProcessing}
              className="flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 py-1 hover:bg-neutral-700 text-neutral-200"
            >
              ↺
            </button>
            <button
              type="button"
              onClick={onRotateCW}
              title="Rotate 90° CW"
              disabled={isProcessing}
              className="flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 py-1 hover:bg-neutral-700 text-neutral-200"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={onFlipH}
              title="Flip Horizontal"
              disabled={isProcessing}
              className="flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 py-1 hover:bg-neutral-700 text-neutral-200"
            >
              ⇄
            </button>
            <button
              type="button"
              onClick={onFlipV}
              title="Flip Vertical"
              disabled={isProcessing}
              className="flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 py-1 hover:bg-neutral-700 text-neutral-200"
            >
              ⇅
            </button>
          </div>
        </div>

        {/* Compress for Portals */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
          <span className="font-semibold text-neutral-200">Portal Compress</span>
          <button
            type="button"
            onClick={onCompress50Kb}
            disabled={isProcessing}
            className="flex items-center justify-center rounded border border-amber-500/40 bg-amber-950/40 py-1 font-medium text-amber-200 hover:bg-amber-900/50"
          >
            Compress ≤ 50 KB (PAN/Gov)
          </button>
        </div>
      </div>

      {/* ─── Comparison & Reset ───────────────────────────────────────── */}
      {hasOriginal && (
        <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
          <button
            type="button"
            onClick={onToggleCompare}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition",
              isComparing
                ? "bg-purple-600 text-white"
                : "border border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white"
            )}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
            {isComparing ? "Exit Before/After" : "Compare Before/After"}
          </button>

          <button
            type="button"
            onClick={onResetToOriginal}
            disabled={isProcessing}
            className="text-xs text-neutral-400 hover:text-red-400 transition"
          >
            Reset to Original
          </button>
        </div>
      )}
    </div>
  );
});
