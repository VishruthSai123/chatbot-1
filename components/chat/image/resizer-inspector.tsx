"use client";

import { ChevronDown, Download, Loader2, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { parseAspectRatio } from "@/lib/image/dimensions";
import {
  type DpiOption,
  findPresetsByQuery,
  getPresetByKey,
  groupPresetsByCategory,
  PHOTO_PRESETS,
  type PhotoPreset,
  type PhysicalUnit,
  physicalToPixels,
  UNIT_OPTIONS,
} from "@/lib/image/presets";
import { cn } from "@/lib/utils";

interface ResizerInspectorProps {
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

const DPI_VALUES: DpiOption[] = [72, 150, 300, 600];

/** Quick aspect-ratio lock options ("free" keeps the manual width/height). */
const ASPECT_OPTIONS: { key: string; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "1:1", label: "1:1" },
  { key: "4:5", label: "4:5" },
  { key: "5:7", label: "5:7" },
  { key: "7:9", label: "7:9" },
  { key: "2:3", label: "2:3" },
  { key: "16:9", label: "16:9" },
];

function presetLabel(preset: PhotoPreset): string {
  return `${preset.displayName} (${preset.width} × ${preset.height} ${preset.unit})`;
}

export const ResizerInspector = memo(function InnerResizerInspector({
  appliedParams,
  documentId,
  imageSrc,
  onUpdateImage,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
  versionIndex,
}: ResizerInspectorProps) {
  const [selectedPreset, setSelectedPreset] =
    useState<string>("indian_passport");
  const [width, setWidth] = useState<number>(35);
  const [height, setHeight] = useState<number>(45);
  const [unit, setUnit] = useState<PhysicalUnit>("mm");
  const [dpi, setDpi] = useState<DpiOption>(300);
  const [fit, _setFit] = useState<"cover" | "contain">("cover");
  const [presetQuery, setPresetQuery] = useState("");
  const [aspect, setAspect] = useState<string>("free");

  const presetGroups = groupPresetsByCategory();
  const trimmedQuery = presetQuery.trim();
  const matchedPresets = trimmedQuery
    ? findPresetsByQuery(trimmedQuery, 40)
    : null;

  const handleSelectPreset = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey);
    setAspect("free");
    if (presetKey === "custom") {
      return;
    }
    const found = PHOTO_PRESETS.find((p) => p.key === presetKey);
    if (found) {
      setWidth(found.width);
      setHeight(found.height);
      setUnit(found.unit);
      setDpi(found.dpi);
    }
  }, []);

  const handleSelectAspect = useCallback(
    (key: string) => {
      setAspect(key);
      if (key === "free") {
        return;
      }
      const ratio = parseAspectRatio(key);
      if (!ratio || width <= 0) {
        return;
      }
      setHeight(Number((width / ratio).toFixed(2)));
      setSelectedPreset("custom");
    },
    [width]
  );

  const computedPxW = physicalToPixels(width, unit, dpi);
  const computedPxH = physicalToPixels(height, unit, dpi);

  // Pre-fill from the values the model applied via chat, when present.
  useEffect(() => {
    if (!appliedParams) {
      return;
    }
    const presetKey =
      typeof appliedParams.preset === "string" ? appliedParams.preset : null;
    const preset = presetKey ? getPresetByKey(presetKey) : undefined;
    if (preset) {
      setSelectedPreset(preset.key);
      setWidth(preset.width);
      setHeight(preset.height);
      setUnit(preset.unit);
      setDpi(preset.dpi);
      setAspect(preset.aspectRatio);
    } else {
      if (typeof appliedParams.width === "number") {
        setWidth(appliedParams.width);
      }
      if (typeof appliedParams.height === "number") {
        setHeight(appliedParams.height);
      }
      if (typeof appliedParams.unit === "string") {
        setUnit(appliedParams.unit as PhysicalUnit);
      }
      if (typeof appliedParams.dpi === "number") {
        setDpi(appliedParams.dpi as DpiOption);
      }
      setAspect(
        typeof appliedParams.aspectRatio === "string" &&
          parseAspectRatio(appliedParams.aspectRatio) !== null
          ? appliedParams.aspectRatio
          : "free"
      );
      setSelectedPreset("custom");
    }
    if (appliedParams.fit === "cover" || appliedParams.fit === "contain") {
      _setFit(appliedParams.fit);
    }
  }, [appliedParams]);

  const handleApplyResize = useCallback(async () => {
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
            action: "resize_physical",
            documentId,
            params: {
              aspectRatio: aspect === "free" ? undefined : aspect,
              dpi,
              fit,
              height,
              quality: 95,
              unit,
              width,
            },
            versionIndex,
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

        let errMessage = "Resize failed";
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
          `Resized to ${width}×${height} ${unit} (${data.result.width}×${data.result.height} px)`
        );
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to resize photo");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isGuest,
    onRequireAuth,
    isProcessing,
    setIsProcessing,
    documentId,
    width,
    height,
    unit,
    dpi,
    fit,
    onUpdateImage,
    aspect,
    versionIndex,
  ]);

  const handleDownload = useCallback(() => {
    if (!imageSrc) {
      return;
    }
    const link = document.createElement("a");
    link.href = imageSrc.startsWith("data:")
      ? imageSrc
      : `data:image/jpeg;base64,${imageSrc}`;
    link.download = `photo-${width}x${height}${unit}-${Date.now()}.jpg`;
    link.click();
    toast.success("Download started");
  }, [imageSrc, width, height, unit]);

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="space-y-3.5">
        {/* Preset Dropdown */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              className="text-xs font-medium text-foreground block"
              htmlFor="preset-select"
            >
              Document preset
            </label>
            <span className="text-xs font-medium text-muted-foreground rounded bg-muted/60 px-2 py-0.5 tabular-nums">
              {width}×{height} {unit}
            </span>
          </div>
          <input
            className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
            id="preset-search"
            onChange={(e) => setPresetQuery(e.target.value)}
            placeholder="Search presets (e.g. china visa, 2x2 inch)"
            type="search"
            value={presetQuery}
          />
          <div className="relative">
            <select
              className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2 pr-8 text-xs font-medium text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
              id="preset-select"
              onChange={(e) => handleSelectPreset(e.target.value)}
              value={selectedPreset}
            >
              {matchedPresets && matchedPresets.length > 0 ? (
                <optgroup label={`Matches (${matchedPresets.length})`}>
                  {matchedPresets.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {presetLabel(preset)}
                    </option>
                  ))}
                </optgroup>
              ) : (
                presetGroups.map((group) => (
                  <optgroup key={group.category} label={group.label}>
                    {group.presets.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {presetLabel(preset)}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
              <option value="custom">Custom Dimensions...</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
        </div>

        {/* Dimensions & Unit */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">
            Dimensions & unit
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                Width
              </span>
              <input
                className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-foreground tabular-nums focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
                min="1"
                onChange={(e) => {
                  setWidth(Number.parseFloat(e.target.value) || 0);
                  setSelectedPreset("custom");
                  setAspect("free");
                }}
                step="0.1"
                type="number"
                value={width}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                Height
              </span>
              <input
                className="w-full rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-foreground tabular-nums focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors"
                min="1"
                onChange={(e) => {
                  setHeight(Number.parseFloat(e.target.value) || 0);
                  setSelectedPreset("custom");
                  setAspect("free");
                }}
                step="0.1"
                type="number"
                value={height}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                Unit
              </span>
              <div className="relative">
                <select
                  className="w-full appearance-none rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5 pr-6 text-xs text-foreground focus:border-foreground/50 focus:bg-background focus:outline-none transition-colors cursor-pointer"
                  onChange={(e) => {
                    setUnit(e.target.value as PhysicalUnit);
                    setSelectedPreset("custom");
                    setAspect("free");
                  }}
                  value={unit}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* Aspect ratio lock */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">
            Aspect ratio lock
          </div>
          <div className="grid grid-cols-4 gap-1">
            {ASPECT_OPTIONS.map((option) => {
              const isActive = aspect === option.key;
              return (
                <button
                  className={cn(
                    "rounded-md border border-border/60 py-1 text-center text-xs font-medium tabular-nums transition-colors cursor-pointer",
                    isActive
                      ? "border-foreground bg-foreground text-background font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={option.key}
                  onClick={() => handleSelectAspect(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Resolution (DPI) Segmented Bar */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">Resolution</div>
          <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg border border-border/60 bg-muted/20">
            {DPI_VALUES.map((val) => {
              const isActive = dpi === val;
              return (
                <button
                  className={cn(
                    "rounded-md py-1.5 text-center text-xs font-medium tabular-nums transition-all cursor-pointer",
                    isActive
                      ? "bg-foreground text-background font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={val}
                  onClick={() => setDpi(val)}
                  type="button"
                >
                  {val} DPI
                </button>
              );
            })}
          </div>
        </div>

        {/* Calculated Output Telemetry */}
        <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-xs space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">
              Output dimensions
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {computedPxW} × {computedPxH} px
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Aspect ratio</span>
            <span className="text-muted-foreground font-medium tabular-nums">
              {height > 0 ? (width / height).toFixed(2) : "1.00"} : 1
            </span>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing || width <= 0 || height <= 0}
          onClick={handleApplyResize}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Resizing...</span>
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              <span>Apply Resize</span>
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
