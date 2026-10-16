"use client";

import cn from "classnames";
import { memo, useCallback, useEffect, useRef, useState } from "react";

interface BeforeAfterSliderProps {
  afterLabel?: string;
  afterSrc: string;
  beforeLabel?: string;
  beforeSrc: string;
  className?: string;
}

export const BeforeAfterSlider = memo(function InnerBeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "Original",
  afterLabel = "Processed",
  className,
}: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50); // percentage 0 - 100
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const clampedX = Math.max(0, Math.min(x, rect.width));
    const percentage = (clampedX / rect.width) * 100;
    setSliderPosition(percentage);
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging || e.touches.length === 0) {
        return;
      }
      handleMove(e.touches[0].clientX);
    },
    [isDragging, handleMove]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }
      handleMove(e.clientX);
    },
    [isDragging, handleMove]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove);
      window.addEventListener("touchend", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove]);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag comparison slider
    // biome-ignore lint/a11y/noStaticElementInteractions: drag comparison slider
    <div
      className={cn(
        "relative select-none overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl",
        className
      )}
      onMouseDown={() => setIsDragging(true)}
      onTouchStart={() => setIsDragging(true)}
      ref={containerRef}
      style={{ touchAction: "none" }}
    >
      {/* Background / After Image */}
      <picture>
        <img
          alt={afterLabel}
          className="block h-full w-full object-contain pointer-events-none"
          draggable={false}
          src={afterSrc}
        />
      </picture>

      {/* Foreground / Before Image (Clipped) */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{
          clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
        }}
      >
        <picture>
          <img
            alt={beforeLabel}
            className="block h-full w-full object-contain pointer-events-none"
            draggable={false}
            src={beforeSrc}
          />
        </picture>
      </div>

      {/* Divider Bar & Handle */}
      <div
        className="absolute top-0 bottom-0 z-20 w-0.5 bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)] cursor-ew-resize"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Circular Thumb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-neutral-900/90 text-white shadow-lg backdrop-blur transition-transform active:scale-110">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M8 9l-4 3 4 3m8-6l4 3-4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-3 left-3 z-10 rounded-md bg-black/60 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur pointer-events-none">
        {beforeLabel}
      </div>
      <div className="absolute top-3 right-3 z-10 rounded-md bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-300 backdrop-blur pointer-events-none">
        {afterLabel}
      </div>
    </div>
  );
});
