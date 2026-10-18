"use client";

import { Fragment, memo, useCallback, useRef, useState } from "react";

import {
  applyCropDrag,
  type CropBox,
  type CropHandle,
} from "@/lib/image/crop-box";
import { cn } from "@/lib/utils";

type HandleSpec = {
  cursor: string;
  key: CropHandle;
  label: string;
  position: string;
};

/** Corner handles are the primary affordance, so they get the larger target. */
const CORNER_HIT_PX = 44;
const EDGE_HIT_PX = 34;

/** Corner bracket arm length / thickness, in px before zoom compensation. */
const BRACKET_LENGTH = 22;
const BRACKET_THICKNESS = 3;
// Bars straddle the frame line, hence the literal -1.5px offsets below
// (half the thickness). Kept literal so Tailwind's scanner can see them.

/** Keeps white marks legible on white photos. */
const KNOB_SHADOW = "shadow-[0_0_4px_rgba(0,0,0,0.6)]";

const HANDLES: HandleSpec[] = [
  {
    cursor: "cursor-nwse-resize",
    key: "nw",
    label: "Resize from the top left",
    position: "left-0 top-0",
  },
  {
    cursor: "cursor-nesw-resize",
    key: "ne",
    label: "Resize from the top right",
    position: "right-0 top-0",
  },
  {
    cursor: "cursor-nwse-resize",
    key: "se",
    label: "Resize from the bottom right",
    position: "bottom-0 right-0",
  },
  {
    cursor: "cursor-nesw-resize",
    key: "sw",
    label: "Resize from the bottom left",
    position: "bottom-0 left-0",
  },
  {
    cursor: "cursor-ns-resize",
    key: "n",
    label: "Resize the top edge",
    position: "left-1/2 top-0",
  },
  {
    cursor: "cursor-ew-resize",
    key: "e",
    label: "Resize the right edge",
    position: "right-0 top-1/2",
  },
  {
    cursor: "cursor-ns-resize",
    key: "s",
    label: "Resize the bottom edge",
    position: "bottom-0 left-1/2",
  },
  {
    cursor: "cursor-ew-resize",
    key: "w",
    label: "Resize the left edge",
    position: "left-0 top-1/2",
  },
];

const CORNER_BRACKETS: { key: string; position: string }[] = [
  { key: "nw", position: "left-[-1.5px] top-[-1.5px]" },
  { key: "ne", position: "right-[-1.5px] top-[-1.5px]" },
  { key: "se", position: "bottom-[-1.5px] right-[-1.5px]" },
  { key: "sw", position: "bottom-[-1.5px] left-[-1.5px]" },
];

const boxStyle = (box: CropBox) => ({
  height: `${box.height}%`,
  left: `${box.x}%`,
  top: `${box.y}%`,
  width: `${box.width}%`,
});

/** Visible mark for a handle: nothing on corners (brackets cover those). */
function edgeKnobStyle(handle: CropHandle) {
  return handle === "n" || handle === "s"
    ? { height: BRACKET_THICKNESS, width: 26 }
    : { height: 26, width: BRACKET_THICKNESS };
}

/**
 * Dims everything outside the crop box. Rendered *inside* the clipped image box
 * so the shading never bleeds into the surrounding canvas.
 *
 * Deliberately geometry-free beyond the four rectangles: the frame, grid and
 * brackets all live in {@link CropOverlay} so there is exactly one of each and
 * they cannot drift out of alignment.
 */
export const CropShade = memo(function InnerCropShade({
  box,
}: {
  box: CropBox;
}) {
  const right = Math.max(0, 100 - box.x - box.width);
  const bottom = Math.max(0, 100 - box.y - box.height);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute bg-black/55"
        style={{ height: `${box.y}%`, left: 0, top: 0, width: "100%" }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          height: `${bottom}%`,
          left: 0,
          top: `${box.y + box.height}%`,
          width: "100%",
        }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          height: `${box.height}%`,
          left: 0,
          top: `${box.y}%`,
          width: `${box.x}%`,
        }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          height: `${box.height}%`,
          left: `${box.x + box.width}%`,
          top: `${box.y}%`,
          width: `${right}%`,
        }}
      />
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
 * The single source of truth for crop chrome: one white frame, one rule-of-thirds
 * grid and one set of brackets/handles. Drag anywhere inside to move it, drag a
 * handle to resize. Uses pointer events with pointer capture so one
 * implementation covers mouse, pen and touch — and a drag keeps working when the
 * finger leaves the element or even the window.
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

  return (
    <div
      className="absolute inset-0 z-20"
      onPointerCancel={endDrag}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      ref={frameRef}
    >
      <div
        className="absolute touch-none cursor-move border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        onPointerDown={(event) => beginDrag(event, "move")}
        style={boxStyle(box)}
      >
        {/* Rule-of-thirds guides — one grid, aligned to this frame. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
        </div>

        {/* Corner brackets, straddling the frame line. */}
        {CORNER_BRACKETS.map((bracket) => (
          <Fragment key={bracket.key}>
            <span
              className={cn(
                "pointer-events-none absolute rounded-full bg-white",
                KNOB_SHADOW,
                bracket.position
              )}
              style={{ height: BRACKET_THICKNESS, width: BRACKET_LENGTH }}
            />
            <span
              className={cn(
                "pointer-events-none absolute rounded-full bg-white",
                KNOB_SHADOW,
                bracket.position
              )}
              style={{ height: BRACKET_LENGTH, width: BRACKET_THICKNESS }}
            />
          </Fragment>
        ))}

        {/* Edge bars. */}
        {HANDLES.filter((spec) => spec.key.length === 1).map((spec) => (
          <span
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white",
              KNOB_SHADOW,
              spec.position
            )}
            key={spec.key}
            style={edgeKnobStyle(spec.key)}
          />
        ))}
      </div>

      {/* Live pixel size, tucked under the frame so it never covers the selection. */}
      {box.width >= 24 ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100 tabular-nums shadow-sm ring-1 ring-white/10"
          style={{
            left: `${box.x + box.width / 2}%`,
            top: `calc(${box.y + box.height}% + 8px)`,
          }}
        >
          {pixelWidth} × {pixelHeight}
        </div>
      ) : null}

      {HANDLES.map((spec) => {
        const isCorner = spec.key.length === 2;
        const hit = (isCorner ? CORNER_HIT_PX : EDGE_HIT_PX) * hitScale;
        const isActive = activeHandle === spec.key;

        return (
          <button
            aria-label={spec.label}
            className={cn(
              "absolute z-30 flex touch-none items-center justify-center rounded-sm transition-colors",
              "-translate-x-1/2 -translate-y-1/2",
              spec.position,
              spec.cursor,
              isActive && "bg-white/10"
            )}
            key={spec.key}
            onPointerDown={(event) => beginDrag(event, spec.key)}
            style={{ height: `${hit}px`, width: `${hit}px` }}
            type="button"
          />
        );
      })}
    </div>
  );
});
