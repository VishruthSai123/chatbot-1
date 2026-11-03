/*
 * Turning HTML into readable text.
 *
 * Pure, so the rules can be tested against a fixture instead of a live page.
 *
 * This is deliberately not a full HTML parser. It exists to get the *words*
 * out of a page for a model to read: scripts, styles, comments and tags are
 * noise, and what is left is the content. Anything that needs the document's
 * structure belongs in a real parser, not here.
 */

/** The named entities that actually appear in page text. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Decodes the character references a page is likely to contain. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const replacement = NAMED_ENTITIES[name.toLowerCase()];

      return replacement ?? match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10))
    );
}

/**
 * The visible text of an HTML document.
 *
 * Block-level elements become a space so that two paragraphs do not run
 * together into one word, and the result is collapsed to a single line.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}
