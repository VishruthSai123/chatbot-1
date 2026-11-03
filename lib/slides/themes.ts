/*
 * Deck themes.
 *
 * A theme is data — colours, fonts, spacing — not design work per deck. That is
 * what makes a generated deck look deliberate: the model writes the words, the
 * theme decides how they look, and every slide shares the same rules.
 *
 * The fonts are ones PowerPoint has on every platform, because a deck that
 * substitutes its typeface on the client is a deck that reflows.
 */

export type ThemeId = "bold" | "editorial" | "minimal" | "mono";

export type SlideTheme = {
  /** A short label for the picker. */
  name: string;
  /** The slide background. */
  background: string;
  /** A panel colour for stat and section slides. */
  surface: string;
  /** Body text. */
  text: string;
  /** Secondary text. */
  muted: string;
  /** The rule, bar and highlight colour. */
  accent: string;
  /** Headline face. */
  headingFont: string;
  /** Body face. */
  bodyFont: string;
  /** True when the background is dark, so the preview can pick its shadow. */
  dark: boolean;
};

export const themes: Record<ThemeId, SlideTheme> = {
  bold: {
    accent: "FBBF24",
    background: "111113",
    bodyFont: "Arial",
    dark: true,
    headingFont: "Arial",
    muted: "A1A1AA",
    name: "Bold",
    surface: "1C1C1F",
    text: "FAFAFA",
  },
  editorial: {
    accent: "9A3412",
    background: "FAF7F2",
    bodyFont: "Georgia",
    dark: false,
    headingFont: "Georgia",
    muted: "6B6257",
    name: "Editorial",
    surface: "F1EAE0",
    text: "1C1917",
  },
  minimal: {
    accent: "2563EB",
    background: "FFFFFF",
    bodyFont: "Trebuchet MS",
    dark: false,
    headingFont: "Trebuchet MS",
    muted: "64748B",
    name: "Minimal",
    surface: "F1F5F9",
    text: "0F172A",
  },
  mono: {
    accent: "18181B",
    background: "FFFFFF",
    bodyFont: "Arial",
    dark: false,
    headingFont: "Arial",
    muted: "71717A",
    name: "Mono",
    surface: "F4F4F5",
    text: "18181B",
  },
};

export const themeIds = Object.keys(themes) as ThemeId[];

/** The theme for an id, falling back to the monochrome one. */
export function themeFor(id: string | undefined): SlideTheme {
  return themes[themeIdFor(id)] ?? themes.mono;
}

/** The id a deck should store for a theme. */
export function themeIdFor(id: string | undefined): ThemeId {
  return themeIds.includes(id as ThemeId) ? (id as ThemeId) : "mono";
}
