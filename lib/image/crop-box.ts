/**
 * Pure geometry for the interactive crop box.
 *
 * All values are percentages of the rendered image (0-100) so a crop survives
 * zooming, resizing and version changes. Keeping the maths here (pointer-event
 * free, DOM free) means the touch/resize behaviour is unit-testable.
 */

export type CropBox = {
  /** Percentage of the image height, 0-100. */
  height: number;
  /** Percentage of the image width, 0-100. */
  width: number;
  /** Percentage from the left edge, 0-100. */
  x: number;
  /** Percentage from the top edge, 0-100. */
  y: number;
};

export type CropHandle =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

export const MIN_CROP_PCT = 6;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Converts a locked pixel aspect ratio into percentage space, where
 * `height% = width% * k`. Needed because the image is rarely square: on a
 * 4000x3000 photo a 1:1 crop is 80% x 60%, not 80% x 80%.
 */
export function aspectRatioInPercent({
  naturalHeight,
  naturalWidth,
  ratio,
}: {
  naturalHeight: number;
  naturalWidth: number;
  ratio: number | null;
}): number | null {
  if (!(ratio && ratio > 0 && naturalWidth > 0 && naturalHeight > 0)) {
    return null;
  }

  return naturalWidth / (ratio * naturalHeight);
}

/** Keeps a box inside the frame, preserving its size where possible. */
export function clampCropBox(box: CropBox, min = MIN_CROP_PCT): CropBox {
  const width = clamp(box.width, min, 100);
  const height = clamp(box.height, min, 100);

  return {
    height,
    width,
    x: clamp(box.x, 0, 100 - width),
    y: clamp(box.y, 0, 100 - height),
  };
}

/** Largest box with the given aspect (percentage space), centred and inset. */
export function boxForAspect(aspectK: number | null, fillPct = 80): CropBox {
  let width = fillPct;
  let height = aspectK !== null && aspectK > 0 ? width * aspectK : fillPct;

  if (height > fillPct) {
    const scale = fillPct / height;
    width *= scale;
    height *= scale;
  }

  return {
    height,
    width,
    x: (100 - width) / 2,
    y: (100 - height) / 2,
  };
}

export function fullCropBox(): CropBox {
  return { height: 100, width: 100, x: 0, y: 0 };
}

/** Shrinks an aspect-locked box proportionally until it fits the frame. */
function fitToFrame(box: CropBox): CropBox {
  if (box.width <= 100 && box.height <= 100) {
    return box;
  }

  const scale = Math.min(100 / box.width, 100 / box.height);

  return {
    ...box,
    height: box.height * scale,
    width: box.width * scale,
  };
}

/** Re-derives the perpendicular edge so the locked aspect is respected. */
function lockAspect({
  aspectK,
  box,
  dx,
  dy,
  movesEast,
  movesNorth,
  movesSouth,
  movesWest,
}: {
  aspectK: number;
  box: CropBox;
  dx: number;
  dy: number;
  movesEast: boolean;
  movesNorth: boolean;
  movesSouth: boolean;
  movesWest: boolean;
}): CropBox {
  const horizontalOnly =
    (movesEast || movesWest) && !(movesNorth || movesSouth);
  const verticalOnly = (movesNorth || movesSouth) && !(movesEast || movesWest);
  const isCorner = (movesEast || movesWest) && (movesNorth || movesSouth);

  // Follow whichever axis the pointer moved along most, so dragging an aspect
  // locked corner feels right in both directions.
  const widthDrives =
    horizontalOnly || (isCorner && Math.abs(dx) >= Math.abs(dy));

  if (widthDrives) {
    const height = box.width * aspectK;

    if (horizontalOnly) {
      const centerY = box.y + box.height / 2;
      return { ...box, height, y: centerY - height / 2 };
    }

    // Corner: keep the untouched vertical edge anchored.
    return movesNorth
      ? { ...box, height, y: box.y + box.height - height }
      : { ...box, height };
  }

  const width = aspectK === 0 ? box.width : box.height / aspectK;

  if (verticalOnly) {
    const centerX = box.x + box.width / 2;
    return { ...box, width, x: centerX - width / 2 };
  }

  return movesWest
    ? { ...box, width, x: box.x + box.width - width }
    : { ...box, width };
}

/**
 * Applies a pointer drag to the crop box.
 *
 * `dx`/`dy` are pointer deltas converted to percentage points of the rendered
 * image (so the same code works at any zoom level or screen size).
 */
export function applyCropDrag({
  aspectK,
  dx,
  dy,
  handle,
  initial,
  min = MIN_CROP_PCT,
}: {
  aspectK: number | null;
  dx: number;
  dy: number;
  handle: CropHandle;
  initial: CropBox;
  min?: number;
}): CropBox {
  if (handle === "move") {
    return {
      ...initial,
      x: clamp(initial.x + dx, 0, 100 - initial.width),
      y: clamp(initial.y + dy, 0, 100 - initial.height),
    };
  }

  const movesNorth = handle.includes("n");
  const movesSouth = handle.includes("s");
  const movesWest = handle.includes("w");
  const movesEast = handle.includes("e");

  let left = initial.x;
  let right = initial.x + initial.width;
  let top = initial.y;
  let bottom = initial.y + initial.height;

  if (movesWest) {
    left = clamp(left + dx, 0, right - min);
  }
  if (movesEast) {
    right = clamp(right + dx, left + min, 100);
  }
  if (movesNorth) {
    top = clamp(top + dy, 0, bottom - min);
  }
  if (movesSouth) {
    bottom = clamp(bottom + dy, top + min, 100);
  }

  const free: CropBox = {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };

  if (!(aspectK !== null && aspectK > 0)) {
    return clampCropBox(free, min);
  }

  return clampCropBox(
    fitToFrame(
      lockAspect({
        aspectK,
        box: free,
        dx,
        dy,
        movesEast,
        movesNorth,
        movesSouth,
        movesWest,
      })
    ),
    min
  );
}
