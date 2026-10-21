/**
 * Canvas geometry for the PDF studio.
 *
 * Pure arithmetic, deliberately free of `server-only` and of pdf.js, because the
 * failure this guards against is silent: a viewport with a `NaN` size produces a
 * canvas the browser sets to **0×0**, and a 0×0 canvas draws nothing at all —
 * a blank page with no error anywhere.
 *
 * pdf.js v6 removed the `scale = 1` default from `getViewport`, so a viewport
 * built without an explicit scale has `NaN` dimensions. These helpers turn that
 * class of mistake into a visible failure instead of a blank rectangle.
 */

export type ViewportLike = { height: number; width: number };

export type CanvasSize = { height: number; width: number };

/**
 * True when a viewport has dimensions a canvas can actually be sized to.
 *
 * A viewport is unusable if either dimension is `NaN`, `Infinity`, or smaller
 * than one pixel. `NaN` is the one that bit us: `Math.max(1, NaN)` is `NaN`,
 * and assigning `NaN` to `canvas.width` leaves the canvas at 0×0.
 */
export function isUsableViewport(viewport: ViewportLike): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width >= 1 &&
    viewport.height >= 1
  );
}

/**
 * The pixel size for a canvas that will show this viewport.
 *
 * Returns `null` for an unusable viewport, so the caller can report a failure
 * rather than draw a blank page.
 */
export function canvasSizeFor(viewport: ViewportLike): CanvasSize | null {
  if (!isUsableViewport(viewport)) {
    return null;
  }

  return {
    height: Math.floor(viewport.height),
    width: Math.floor(viewport.width),
  };
}

/**
 * The scale that fits a page of `baseWidth` into `targetWidth` CSS pixels.
 *
 * `dpr` multiplies the result so the drawing is sharp on high-density
 * displays; the canvas is then sized in device pixels and displayed at the
 * CSS size.
 */
export function fitScale(
  baseWidth: number,
  targetWidth: number,
  dpr: number
): number {
  if (!(baseWidth > 0) || !Number.isFinite(baseWidth)) {
    return 1;
  }

  if (!(targetWidth > 0) || !Number.isFinite(targetWidth)) {
    return 1;
  }

  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  return (targetWidth / baseWidth) * ratio;
}

/**
 * The device pixel ratio to render at, capped so a 3× phone does not produce a
 * needlessly enormous canvas.
 */
export function renderDpr(): number {
  if (typeof window === "undefined") {
    return 2;
  }

  return Math.min(window.devicePixelRatio || 2, 3);
}
