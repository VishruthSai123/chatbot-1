/*
 * How a deck is addressed.
 *
 * Same convention as every other family: `Document.content` holds a small
 * descriptor and the deck itself is inside it. A deck is a few kilobytes of
 * JSON, so unlike a PDF it does not need its own storage object — and keeping
 * it in the document is what lets the studio edit and re-export it.
 */

import type { Deck } from "./schema";

export type SlidesRef = {
  /** The deck, as the studio renders it. */
  deck: Deck;
  /** Which theme it was generated with. */
  theme?: string;
  title?: string;
};

const SLIDES_REF_MARKER = "slides-ref:";

export function encodeSlidesRef(ref: SlidesRef): string {
  return `${SLIDES_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeSlidesRef(
  content: string | null | undefined
): SlidesRef | null {
  if (!content?.startsWith(SLIDES_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(SLIDES_REF_MARKER.length)
    ) as SlidesRef;

    if (!parsed?.deck || !Array.isArray(parsed.deck.slides)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isSlidesRef(content: string | null | undefined): boolean {
  return decodeSlidesRef(content) !== null;
}
