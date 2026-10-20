/**
 * Pure page arithmetic for the PDF family.
 *
 * Deliberately free of `server-only` and of `pdf-lib`: these are the rules that
 * decide *which* pages a user gets, and they are the easiest thing in the whole
 * family to get subtly wrong. Keeping them importable by the unit suite means the
 * browser, the API route and the tests share one definition of "pages 2-4".
 */

/** PDF pages support four quarter turns; anything else is snapped. */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * Parses `"1-3, 5, 8-"` into sorted, de-duplicated 1-based page numbers.
 *
 * An empty expression means "the whole document". Reversed ranges are read as
 * the user clearly meant them (`3-1` is `1-3`) rather than rejected, and pages
 * past the end are dropped — a slightly wrong range should still produce a
 * document, not an error dialog.
 */
export function parsePageRanges(
  expression: string,
  totalPages: number
): number[] {
  const trimmed = expression.trim();

  if (!trimmed) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>();

  for (const part of trimmed.split(",")) {
    const chunk = part.trim();

    if (!chunk) {
      continue;
    }

    // Also accepts en/em dashes, which arrive whenever a range is pasted out of a
    // word processor instead of typed.
    const range = chunk
      .replace(/[\u2013\u2014]/g, "-")
      .match(/^(\d+)?\s*-\s*(\d+)?$/);

    if (range) {
      const start = range[1] ? Number.parseInt(range[1], 10) : 1;
      const end = range[2] ? Number.parseInt(range[2], 10) : totalPages;
      const low = Math.max(1, Math.min(start, end));
      const high = Math.min(totalPages, Math.max(start, end));

      for (let page = low; page <= high; page += 1) {
        pages.add(page);
      }

      continue;
    }

    const single = Number.parseInt(chunk, 10);
    if (Number.isFinite(single) && single >= 1 && single <= totalPages) {
      pages.add(single);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Normalises any angle to the nearest quarter turn.
 *
 * A PDF page stores an absolute rotation, so values arrive from several places
 * (a slider, an accumulated button press, a stored version) and must all collapse
 * onto 0/90/180/270 before being written back.
 */
export function normaliseDegrees(value: number): PageRotation {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const wrapped = (((Math.round(value / 90) * 90) % 360) + 360) % 360;

  return wrapped as PageRotation;
}

/**
 * Validates a requested page order against a document.
 *
 * The studio sends the order the user dragged into, which can contain duplicates
 * (a page dragged twice) or numbers that no longer exist (a page deleted in the
 * same gesture). Those are dropped rather than trusted: a duplicate would silently
 * duplicate a page in the output, and an out-of-range index would throw deep
 * inside `pdf-lib` with an unhelpful message.
 */
export function sanitisePageOrder(
  order: number[] | undefined,
  totalPages: number
): number[] {
  const fallback = Array.from({ length: totalPages }, (_, index) => index + 1);

  if (!order || order.length === 0) {
    return fallback;
  }

  const seen = new Set<number>();
  const cleaned: number[] = [];

  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      continue;
    }

    if (seen.has(page)) {
      continue;
    }

    seen.add(page);
    cleaned.push(page);
  }

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Splits a `";"`-separated range expression into one page list per output file.
 *
 * `"1-3; 4"` means two files. An empty expression means one file containing
 * everything, which is what "split" means when the user has not chosen anything.
 */
export function parseSplitGroups(
  expression: string | undefined,
  totalPages: number
): number[][] {
  const groups = (expression ?? "")
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean);

  if (groups.length === 0) {
    return [parsePageRanges("", totalPages)];
  }

  return groups
    .map((group) => parsePageRanges(group, totalPages))
    .filter((pages) => pages.length > 0);
}
