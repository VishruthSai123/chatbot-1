/*
 * What a deck is.
 *
 * The model does not write a presentation; it fills in this shape. That is the
 * whole trick behind a deck that renders reliably: the copy is constrained, the
 * layout is chosen from a fixed set, and the renderer can therefore guarantee
 * that nothing overflows and every slide has something on it.
 */

import { z } from "zod";

/** The layouts the renderer knows how to draw. */
export const slideLayouts = [
  "title",
  "section",
  "bullets",
  "two-column",
  "quote",
  "stat",
] as const;

export const slideLayoutSchema = z.enum(slideLayouts);

export const slideSchema = z.object({
  /** 3–5 short lines. */
  bullets: z.array(z.string().min(1).max(120)).max(5).optional(),
  /** Exactly two columns, each a short heading and a short body. */
  columns: z
    .array(
      z.object({
        body: z.string().min(1).max(220),
        heading: z.string().min(1).max(48),
      })
    )
    .max(2)
    .optional(),
  layout: slideLayoutSchema,
  /** Speaker notes: what to say, not what is on the slide. */
  notes: z.string().max(700).optional(),
  quote: z
    .object({
      attribution: z.string().max(70).optional(),
      text: z.string().min(1).max(220),
    })
    .optional(),
  stat: z
    .object({
      label: z.string().min(1).max(70),
      value: z.string().min(1).max(14),
    })
    .optional(),
  subtitle: z.string().max(140).optional(),
  /** The headline. Kept short so it cannot wrap into the body. */
  title: z.string().min(1).max(90),
});

export const deckSchema = z.object({
  slides: z.array(slideSchema).min(3).max(20),
  subtitle: z.string().max(160).optional(),
  theme: z.enum(["mono", "editorial", "bold", "minimal"]).optional(),
  title: z.string().min(1).max(90),
});

export type Slide = z.infer<typeof slideSchema>;
export type Deck = z.infer<typeof deckSchema>;
export type SlideLayout = (typeof slideLayouts)[number];

/** The most slides a deck may have, matching the schema. */
export const MAX_SLIDES = 20;
/** The fewest, so "a deck" is never two cards. */
export const MIN_SLIDES = 3;

/** Whether a slide has the content its layout needs. */
export function slideIsComplete(slide: Slide): boolean {
  switch (slide.layout) {
    case "bullets":
      return (slide.bullets?.length ?? 0) > 0;
    case "two-column":
      return (slide.columns?.length ?? 0) === 2;
    case "quote":
      return Boolean(slide.quote?.text);
    case "stat":
      return Boolean(slide.stat?.value && slide.stat.label);
    default:
      return true;
  }
}

/**
 * Makes a generated deck safe to render.
 *
 * Models are good at content and unreliable at structure: they forget a
 * subtitle, return four bullets where the layout expects two columns, or put a
 * paragraph in a headline. This repairs the structure without rewriting the
 * words, so a slightly wrong deck still opens as a deck.
 */
export function normaliseDeck(deck: Deck): Deck {
  const slides = deck.slides
    .map((slide) => {
      const repaired: Slide = {
        ...slide,
        title: slide.title.trim(),
      };

      if (repaired.layout === "bullets") {
        repaired.bullets = (repaired.bullets ?? [])
          .map((bullet) => bullet.trim())
          .filter(Boolean)
          .slice(0, 5);
      }

      if (repaired.layout === "two-column") {
        repaired.columns = (repaired.columns ?? []).slice(0, 2);

        if (repaired.columns.length < 2) {
          // A two-column slide with one column is really a bullets slide.
          repaired.layout = "bullets";
          repaired.bullets = repaired.columns
            .map((column) => `${column.heading}: ${column.body}`)
            .slice(0, 5);
        }
      }

      if (repaired.layout === "quote" && !repaired.quote?.text) {
        repaired.layout = "section";
      }

      if (repaired.layout === "stat" && !repaired.stat?.value) {
        repaired.layout = "section";
      }

      return repaired;
    })
    .filter((slide) => slide.title.length > 0)
    .slice(0, MAX_SLIDES);

  return {
    ...deck,
    slides,
    subtitle: deck.subtitle?.trim() || undefined,
    title: deck.title.trim(),
  };
}

/** A one-line description of a slide, for a thumbnail list. */
export function slideSummary(slide: Slide): string {
  switch (slide.layout) {
    case "bullets":
      return `${slide.bullets?.length ?? 0} points`;
    case "two-column":
      return "Two columns";
    case "quote":
      return "Quote";
    case "stat":
      return slide.stat?.value ?? "Statistic";
    case "section":
      return "Section";
    default:
      return "Title";
  }
}
