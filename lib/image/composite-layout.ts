/**
 * Canvas geometry for image composites.
 *
 * Pure arithmetic, no `sharp`, no `server-only`: the numbers are where the
 * bugs in a composite live, and this way they can be unit tested directly
 * rather than only by rendering an image and measuring the result.
 */

export type Size = { height: number; width: number };

export type StitchDirection = "vertical" | "horizontal";

export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export type PositionedLayer = {
  /** Offset from the canvas's left edge. */
  left: number;
  /** Offset from the canvas's top edge. */
  top: number;
};

export type StitchLayout = {
  height: number;
  layers: PositionedLayer[];
  width: number;
};

export type CollageLayout = {
  cellWidth: number;
  columnCount: number;
  height: number;
  rowCount: number;
  width: number;
};

/**
 * Works out the canvas and the placement of each layer.
 *
 * Images keep their natural size. Scaling them to match would invent detail
 * that was never in the photo, so a smaller image is centred on the longer
 * axis instead of being blown up to fill it.
 */
export function stitchLayout({
  direction = "vertical",
  gap = 0,
  sizes,
}: {
  direction?: StitchDirection;
  /** Gap between images, in pixels. */
  gap?: number;
  sizes: Size[];
}): StitchLayout {
  if (sizes.length === 0) {
    return { height: 0, layers: [], width: 0 };
  }

  const spacing = Math.max(0, gap);
  const isVertical = direction === "vertical";
  const gapTotal = spacing * (sizes.length - 1);

  const width = isVertical
    ? Math.max(...sizes.map((size) => size.width))
    : sizes.reduce((total, size) => total + size.width, 0) + gapTotal;

  const height = isVertical
    ? sizes.reduce((total, size) => total + size.height, 0) + gapTotal
    : Math.max(...sizes.map((size) => size.height));

  const layers: PositionedLayer[] = [];
  let offset = 0;

  for (const size of sizes) {
    layers.push({
      left: isVertical ? Math.round((width - size.width) / 2) : offset,
      top: isVertical ? offset : Math.round((height - size.height) / 2),
    });

    offset += (isVertical ? size.height : size.width) + spacing;
  }

  return { height, layers, width };
}

/**
 * Works out the canvas of a collage grid.
 *
 * A collage is the one composite that *does* scale, because uniform cells are
 * what makes a collage read as a collage.
 */
export function collageLayout({
  cellHeight = 400,
  columns,
  count,
  gap = 12,
}: {
  cellHeight?: number;
  columns?: number;
  /** How many images will be placed. */
  count: number;
  gap?: number;
}): CollageLayout {
  const cell = Math.max(1, Math.round(cellHeight));
  const spacing = Math.max(0, gap);

  // A near-square grid is the default: three photos look best as 2×2 with one
  // gap, four as 2×2, five as 3×2.
  const columnCount = Math.max(
    1,
    Math.min(Math.max(1, count), columns ?? Math.ceil(Math.sqrt(count)))
  );
  const rowCount = Math.max(1, Math.ceil(count / columnCount));

  return {
    cellWidth: cell,
    columnCount,
    height: rowCount * cell + spacing * (rowCount - 1),
    rowCount,
    width: columnCount * cell + spacing * (columnCount - 1),
  };
}

/** Where an overlay sits on the base image. */
export function overlayPosition({
  base,
  overlay,
  position = "bottom-right",
}: {
  base: Size;
  overlay: Size;
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center";
}): PositionedLayer {
  switch (position) {
    case "top-left":
      return { left: 0, top: 0 };
    case "top-right":
      return { left: base.width - overlay.width, top: 0 };
    case "bottom-left":
      return { left: 0, top: base.height - overlay.height };
    case "center":
      return {
        left: Math.round((base.width - overlay.width) / 2),
        top: Math.round((base.height - overlay.height) / 2),
      };
    default:
      return {
        left: base.width - overlay.width,
        top: base.height - overlay.height,
      };
  }
}
