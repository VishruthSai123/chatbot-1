"use client";

import { memo, useCallback, useRef, useState } from "react";

import {
  applyCropDrag,
  type CropBox,
  type CropHandle,
} from "@/lib/image/crop-box";
import { cn } from "@/lib/utils";

type HandleSpec = {
  className: string;
  cursor: string;
  key: CropHandle;
  label: string;
};

/** Corner handles are the primary affordance, so they get the larger target. */
const CORNER_HIT_PX = 44;
const EDGE_HIT_PX = 34;

const HANDLES: HandleSpec[] = [
  {
    className: "left-0 top-0",
    cursor: "cursor-nwse-resize",
    key: "nw",
    label: "Resize from the top left",
  },
  {
    className: "right-0 top-0",
    cursor: "cursor-nesw-resize",
    key: "ne",
    label: "Resize from the top right",
  },
  {
    className: "bottom-0 right-0",
    cursor: "cursor-nwse-resize",
    key: "se",
    label: "Resize from the bottom right",
  },
  {
    className: "bottom-0 left-0",
    cursor: "cursor-nesw-resize",
    key: "sw",
    label: "Resize from the bottom left",
  },
  {
    className: "left-1/2 top-0",
    cursor: "cursor-ns-resize",
    key: "n",
    label: "Resize the top edge",
  },
  {
    className: "right-0 top-1/2",
    cursor: "cursor-ew-resize",
    key: "e",
    label: "Resize the right edge",
  },
  {
    className: "bottom-0 left-1/2",
    cursor: "cursor-ns-resize",
    key: "s",
    label: "Resize the bottom edge",
  },
  {
    className: "left-0 top-1/2",
    cursor: "cursor-ew-resize",
    key: "w",
    label: "Resize the left edge",
  },
];

const boxStyle = (box: CropBox) => ({
  height: `${box.height}%`,
  left: `${box.x}%`,
  top: `${box.y}%`,
  width: `${box.width}%`,
});

/** Visible knob for a handle: a dot on corners, a short bar on edges. */
function handleKnobClass(handle: CropHandle): string {
  if (handle.length === 2) {
    return "size-3.5 rounded-full";
  }
  return handle === "n" || handle === "s"
    ? "h-1.5 w-5 rounded-full"
    : "h-5 w-1.5 rounded-full";
}

/**
 * Darkens everything outside the crop box and paints rule-of-thirds guides.
 * Rendered *inside* the clipped image box so the shading never bleeds into the
 * surrounding canvas.
 */
export const CropShade = memo(function InnerCropShade({
  box,
}: {
  box: CropBox;
}) {
  const right = Math.max(0, 100 - box.x - box.width);
  const bottom = Math.max(0, 100 - box.y - box.height);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div
        className="absolute bg-black/60"
        style={{ height: `${box.y}%`, left: 0, top: 0, width: "100%" }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          height: `${bottom}%`,
          left: 0,
          top: `${box.y + box.height}%`,
          width: "100%",
        }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          height: `${box.height}%`,
          left: 0,
          top: `${box.y}%`,
          width: `${box.x}%`,
        }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          height: `${box.height}%`,
          left: `${box.x + box.width}%`,
          top: `${box.y}%`,
          width: `${right}%`,
        }}
      />

      {/* Rule-of-thirds guides inside the selection. */}
      <div className="absolute border border-white/40" style={boxStyle(box)}>
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
      </div>
    </div>
  );
});

interface CropOverlayProps {
  /** Locked aspect in percentage space (`height% = width% * aspectK`). */
  aspectK: number | null;
  box: CropBox;
  naturalHeight: number;
  naturalWidth: number;
  onChange: (box: CropBox) => void;
  /** Current canvas zoom, used to keep touch targets finger-sized when zoomed out. */
  zoom: number;
}

/**
 * Interactive crop frame: drag anywhere inside to move it, drag a handle to
 * resize. Uses pointer events with pointer capture so one implementation covers
 * mouse, pen and touch — and a drag keeps working when the finger leaves the
 * element or even the window.
 */
export const CropOverlay = memo(function InnerCropOverlay({
  aspectK,
  box,
  naturalHeight,
  naturalWidth,
  onChange,
  zoom,
}: CropOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
  const dragRef = useRef<{
    box: CropBox;
    capture: HTMLElement | null;
    handle: CropHandle;
    pointerId: number;
    rect: { height: number; width: number };
    startX: number;
    startY: number;
  } | null>(null);

  const beginDrag = useCallback(
    (event: React.PointerEvent, handle: CropHandle) => {
      const frame = frameRef.current;
      if (!frame) {
        return;
      }

      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const capture = event.currentTarget as HTMLElement;
      dragRef.current = {
        box: { ...box },
        capture,
        handle,
        pointerId: event.pointerId,
        rect: { height: rect.height, width: rect.width },
        startX: event.clientX,
        startY: event.clientY,
      };
      setActiveHandle(handle);

      try {
        capture.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; dragging still works without it.
      }
    },
    [box]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();

      const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100;
      const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100;

      onChange(
        applyCropDrag({
          aspectK,
          dx,
          dy,
          handle: drag.handle,
          initial: drag.box,
        })
      );
    },
    [aspectK, onChange]
  );

  const endDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setActiveHandle(null);

    try {
      drag.capture?.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be gone (e.g. after a pointer cancel).
    }
  }, []);

  const hitScale = zoom > 0 ? 1 / zoom : 1;
  const pixelWidth = Math.round((box.width / 100) * naturalWidth);
  const pixelHeight = Math.round((box.height / 100) * naturalHeight);
  const isDragging = activeHandle !== null;

  return (
    <div
      className="absolute inset-0 z-20"
      onPointerCancel={endDrag}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      ref={frameRef}
    >
      <div
        className={cn(
          "absolute touch-none cursor-move border-2 border-emerald-400 bg-emerald-400/5",
          isDragging && "border-emerald-300"
        )}
        onPointerDown={(event) => beginDrag(event, "move")}
        style={boxStyle(box)}
      >
        {pixelWidth > 40 && pixelHeight > 26 ? (
          <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[9px] text-zinc-100 tabular-nums">
            {pixelWidth}×{pixelHeight}
          </div>
        ) : null}
      </div>

      {HANDLES.map((spec) => {
        const isCorner = spec.key.length === 2;
        const hit = (isCorner ? CORNER_HIT_PX : EDGE_HIT_PX) * hitScale;
        const isActive = activeHandle === spec.key;

        return (
          <button
            aria-label={spec.label}
            className={cn(
              "absolute z-30 flex touch-none items-center justify-center",
              "-translate-x-1/2 -translate-y-1/2",
              spec.className,
              spec.cursor
            )}
            key={spec.key}
            onPointerDown={(event) => beginDrag(event, spec.key)}
            style={{ height: `${hit}px`, width: `${hit}px` }}
            type="button"
          >
            <span
              className={cn(
                "block bg-emerald-400 shadow-sm ring-2 ring-zinc-950/70 transition-transform",
                handleKnobClass(spec.key),
                isActive && "scale-125"
              )}
            />
          </button>
        );
      })}
    </div>
  );
});
