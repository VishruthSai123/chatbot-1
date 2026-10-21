import "server-only";

import {
  type CollageLayout,
  collageLayout,
  type OverlayPosition,
  overlayPosition,
  type StitchDirection,
  stitchLayout,
} from "./composite-layout";
import { getSharp } from "./native";

export type { OverlayPosition, StitchDirection } from "./composite-layout";

/**
 * Combining several images into one.
 *
 * Four operations, all pure `sharp` compositing: no canvas library, no native
 * binary beyond libvips itself, and no external service.
 *
 * A deliberate rule runs through all of them: **a composite is always written as
 * PNG**. The result of a stitch or an overlay routinely mixes an opaque photo
 * with a cutout that has transparency, and a JPEG would flatten that away with
 * black. PNG keeps the alpha, and the caller can convert afterwards if the
 * user really wants a flat file.
 *
 * The geometry lives in `composite-layout`, which is pure and unit tested; this
 * module only applies it.
 */

export type CompositeResult = {
  buffer: Buffer;
  format: string;
  height: number;
  sizeBytes: number;
  width: number;
};

/** Default gap between stitched images, in pixels. */
const DEFAULT_GAP = 0;

/** Parses `#rrggbb` or `#rrggbbaa` into sharp's background triple. */
function parseBackground(background: string | undefined): {
  alpha: number;
  b: number;
  g: number;
  r: number;
} {
  const value = (background ?? "#00000000").trim();
  const hex = value.replace("#", "");

  if (hex.length === 6) {
    return {
      alpha: 255,
      b: Number.parseInt(hex.slice(4, 6), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      r: Number.parseInt(hex.slice(0, 2), 16),
    };
  }

  if (hex.length === 8) {
    return {
      alpha: Number.parseInt(hex.slice(6, 8), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      r: Number.parseInt(hex.slice(0, 2), 16),
    };
  }

  return { alpha: 0, b: 0, g: 0, r: 0 };
}

/**
 * Scales an image's existing alpha channel.
 *
 * Sharp's `ensureAlpha` *replaces* the alpha channel with a constant, which
 * would throw away a cutout's transparency and turn a logo into a white
 * rectangle. Multiplying the alpha values keeps the shape and fades it, which
 * is what an overlay actually needs.
 */
async function scaleAlpha(buffer: Buffer, opacity: number): Promise<Buffer> {
  if (opacity >= 1) {
    return buffer;
  }

  const sharp = await getSharp();
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);

  for (let index = 3; index < pixels.length; index += 4) {
    pixels[index] = Math.round(pixels[index] * opacity);
  }

  return sharp(pixels, {
    raw: { channels: 4, height: info.height, width: info.width },
  })
    .png()
    .toBuffer();
}

async function readSize(
  buffer: Buffer
): Promise<{ height: number; width: number }> {
  const sharp = await getSharp();
  const meta = await sharp(buffer).metadata();

  return {
    height: meta.height ?? 0,
    width: meta.width ?? 0,
  };
}

/**
 * Stacks images into one, in the order given.
 *
 * A vertical stitch is the classic "long screenshot" or "before/after" strip;
 * a horizontal one puts images side by side.
 */
export async function stitchImages({
  background,
  buffers,
  direction = "vertical",
  gap = DEFAULT_GAP,
}: {
  buffers: Buffer[];
  direction?: StitchDirection;
  /** Gap between images, in pixels. */
  gap?: number;
  /** Canvas colour, as `#rrggbb` or `#rrggbbaa`. */
  background?: string;
}): Promise<CompositeResult> {
  if (buffers.length === 0) {
    throw new Error("Nothing to stitch: provide at least one image.");
  }

  if (buffers.length === 1) {
    const size = await readSize(buffers[0]);
    const sharp = await getSharp();

    return {
      buffer: await sharp(buffers[0]).png().toBuffer(),
      format: "png",
      height: size.height,
      sizeBytes: buffers[0].length,
      width: size.width,
    };
  }

  const sharp = await getSharp();
  const sizes = await Promise.all(buffers.map((buffer) => readSize(buffer)));
  const colour = parseBackground(background);
  const layout = stitchLayout({ direction, gap, sizes });

  const layers: {
    input: Buffer;
    left: number;
    top: number;
  }[] = buffers.map((buffer, index) => ({
    input: buffer,
    left: layout.layers[index].left,
    top: layout.layers[index].top,
  }));

  const canvas = sharp({
    create: {
      background: { ...colour },
      channels: 4,
      height: layout.height,
      width: layout.width,
    },
  });

  const output = await canvas.composite(layers).png().toBuffer();

  return {
    buffer: output,
    format: "png",
    height: layout.height,
    sizeBytes: output.length,
    width: layout.width,
  };
}

/**
 * Places one image on top of another.
 *
 * The overlay is scaled to a fraction of the base so it reads as an overlay
 * rather than replacing the picture, and its opacity is applied through the
 * alpha channel so it blends instead of painting over.
 */
export async function overlayImage({
  base,
  opacity = 1,
  overlay,
  position = "bottom-right",
  scale = 0.4,
}: {
  base: Buffer;
  overlay: Buffer;
  /** 0–1. */
  opacity?: number;
  position?: OverlayPosition;
  /** Overlay size relative to the base's longest edge. */
  scale?: number;
}): Promise<CompositeResult> {
  const sharp = await getSharp();
  const baseSize = await readSize(base);

  if (!(baseSize.width > 0 && baseSize.height > 0)) {
    throw new Error("The base image could not be read.");
  }

  const targetWidth = Math.max(
    1,
    Math.round(baseSize.width * Math.min(1, Math.max(0.05, scale)))
  );

  const prepared = await scaleAlpha(
    await sharp(overlay)
      .resize({ fit: "inside", width: targetWidth, withoutEnlargement: false })
      .png()
      .toBuffer(),
    Math.min(1, Math.max(0, opacity))
  );

  const overlaySize = await readSize(prepared);

  const placement = overlayPosition({
    base: baseSize,
    overlay: overlaySize,
    position,
  });

  const output = await sharp(base)
    .ensureAlpha()
    .composite([{ input: prepared, ...placement }])
    .png()
    .toBuffer();

  return {
    buffer: output,
    format: "png",
    height: baseSize.height,
    sizeBytes: output.length,
    width: baseSize.width,
  };
}

/**
 * Lays images out in a uniform grid.
 *
 * Unlike a stitch, a collage *does* scale: every cell is the same size and the
 * images are cropped to fill it, which is what makes a collage look like a
 * collage. Cells are laid out row by row, left to right.
 */
export async function collageImages({
  background,
  buffers,
  cellHeight = 400,
  columns,
  gap = 12,
}: {
  buffers: Buffer[];
  /** Number of columns. Defaults to a near-square grid. */
  columns?: number;
  /** Cell size in pixels. */
  cellHeight?: number;
  /** Gap between cells, in pixels. */
  gap?: number;
  background?: string;
}): Promise<CompositeResult> {
  if (buffers.length === 0) {
    throw new Error("Nothing to collage: provide at least one image.");
  }

  const sharp = await getSharp();
  const colour = parseBackground(background ?? "#ffffffff");
  const layout: CollageLayout = collageLayout({
    cellHeight,
    columns,
    count: buffers.length,
    gap,
  });

  const { cellWidth, columnCount } = layout;
  const cell = cellWidth;
  const spacing = Math.max(0, gap);

  const layers: { input: Buffer; left: number; top: number }[] = [];

  for (const [index, buffer] of buffers.entries()) {
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;

    // "cover" crops to fill the cell, so every cell is a clean rectangle.
    // biome-ignore lint/performance/noAwaitInLoops: sharp is configured for concurrency 1, so parallel renders would not run in parallel anyway
    const fitted = await sharp(buffer)
      .resize(cellWidth, cell, { fit: "cover", position: "attention" })
      .png()
      .toBuffer();

    layers.push({
      input: fitted,
      left: column * (cellWidth + spacing),
      top: row * (cell + spacing),
    });
  }

  const canvas = sharp({
    create: {
      background: { ...colour },
      channels: 4,
      height: layout.height,
      width: layout.width,
    },
  });

  const output = await canvas.composite(layers).png().toBuffer();

  return {
    buffer: output,
    format: "png",
    height: layout.height,
    sizeBytes: output.length,
    width: layout.width,
  };
}
