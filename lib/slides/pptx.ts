/*
 * Rendering a deck to a real PowerPoint file.
 *
 * `pptxgenjs` is pure JavaScript, so this runs in the browser: the studio
 * builds the file from the deck that is on screen, which means the download is
 * always current and the server never has to store a binary it would have to
 * invalidate on every edit.
 *
 * Every layout is drawn from the same small set of rules — one margin, one
 * type scale, one accent — which is what makes a generated deck look designed
 * rather than assembled.
 */

import type { Deck, Slide } from "./schema";
import { themeFor } from "./themes";

/** 10 × 5.625 inches, the standard widescreen deck. */
const WIDTH = 10;
const HEIGHT = 5.625;
const MARGIN = 0.62;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

/** The type scale, in points. */
const TYPE = {
  body: 15,
  caption: 11,
  heading: 30,
  quote: 24,
  stat: 64,
  subtitle: 15,
  title: 38,
} as const;

/** Draws one slide. */
function drawSlide(
  pptx: any,
  slide: Slide,
  theme: ReturnType<typeof themeFor>,
  number: number
) {
  const page = pptx.addSlide();

  page.background = { color: theme.background };

  if (slide.notes) {
    page.addNotes(slide.notes);
  }

  switch (slide.layout) {
    case "title": {
      page.addShape(pptx.ShapeType.rect, {
        fill: { color: theme.accent },
        h: 0.06,
        w: 1.1,
        x: MARGIN,
        y: HEIGHT / 2 - 0.9,
      });
      page.addText(slide.title, {
        bold: true,
        color: theme.text,
        fontFace: theme.headingFont,
        fontSize: TYPE.title,
        h: 1.6,
        valign: "top",
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: HEIGHT / 2 - 0.68,
      });

      if (slide.subtitle) {
        page.addText(slide.subtitle, {
          color: theme.muted,
          fontFace: theme.bodyFont,
          fontSize: TYPE.subtitle,
          h: 0.9,
          valign: "top",
          w: CONTENT_WIDTH,
          x: MARGIN,
          y: HEIGHT / 2 + 1,
        });
      }

      break;
    }

    case "section": {
      page.addShape(pptx.ShapeType.rect, {
        fill: { color: theme.accent },
        h: HEIGHT,
        w: 0.12,
        x: 0,
        y: 0,
      });
      page.addText(slide.title, {
        bold: true,
        color: theme.text,
        fontFace: theme.headingFont,
        fontSize: TYPE.heading,
        h: 1.4,
        valign: "middle",
        w: CONTENT_WIDTH - 0.4,
        x: MARGIN,
        y: HEIGHT / 2 - 0.7,
      });

      if (slide.subtitle) {
        page.addText(slide.subtitle, {
          color: theme.muted,
          fontFace: theme.bodyFont,
          fontSize: TYPE.body,
          h: 0.8,
          valign: "top",
          w: CONTENT_WIDTH - 0.4,
          x: MARGIN,
          y: HEIGHT / 2 + 0.75,
        });
      }

      break;
    }

    case "quote": {
      page.addText(`“${slide.quote?.text ?? ""}”`, {
        color: theme.text,
        fontFace: theme.headingFont,
        fontSize: TYPE.quote,
        h: 2.6,
        italic: true,
        valign: "middle",
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: 1.2,
      });

      if (slide.quote?.attribution) {
        page.addText(`— ${slide.quote.attribution}`, {
          color: theme.muted,
          fontFace: theme.bodyFont,
          fontSize: TYPE.caption + 2,
          h: 0.5,
          w: CONTENT_WIDTH,
          x: MARGIN,
          y: 4,
        });
      }

      break;
    }

    case "stat": {
      page.addText(slide.stat?.value ?? "", {
        bold: true,
        color: theme.accent,
        fontFace: theme.headingFont,
        fontSize: TYPE.stat,
        h: 1.6,
        valign: "middle",
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: 1.3,
      });
      page.addText(slide.stat?.label ?? slide.title, {
        color: theme.muted,
        fontFace: theme.bodyFont,
        fontSize: TYPE.body + 1,
        h: 0.9,
        valign: "top",
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: 3.05,
      });
      break;
    }

    case "two-column": {
      page.addText(slide.title, {
        bold: true,
        color: theme.text,
        fontFace: theme.headingFont,
        fontSize: TYPE.heading - 6,
        h: 0.9,
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: 0.5,
      });

      const columnWidth = (CONTENT_WIDTH - 0.5) / 2;

      (slide.columns ?? []).slice(0, 2).forEach((column, index) => {
        const x = MARGIN + index * (columnWidth + 0.5);

        page.addText(column.heading, {
          bold: true,
          color: theme.accent,
          fontFace: theme.headingFont,
          fontSize: TYPE.body + 1,
          h: 0.5,
          w: columnWidth,
          x,
          y: 1.65,
        });
        page.addText(column.body, {
          color: theme.muted,
          fontFace: theme.bodyFont,
          fontSize: TYPE.body - 2,
          h: 2.6,
          lineSpacingMultiple: 1.25,
          valign: "top",
          w: columnWidth,
          x,
          y: 2.2,
        });
      });

      break;
    }

    default: {
      // bullets
      page.addText(slide.title, {
        bold: true,
        color: theme.text,
        fontFace: theme.headingFont,
        fontSize: TYPE.heading - 6,
        h: 0.9,
        w: CONTENT_WIDTH,
        x: MARGIN,
        y: 0.5,
      });

      if (slide.bullets?.length) {
        page.addText(
          slide.bullets.map((bullet) => ({
            options: { bullet: { code: "2022" } },
            text: bullet,
          })),
          {
            color: theme.text,
            fontFace: theme.bodyFont,
            fontSize: TYPE.body,
            h: 3.4,
            lineSpacingMultiple: 1.35,
            paraSpaceAfter: 8,
            valign: "top",
            w: CONTENT_WIDTH,
            x: MARGIN,
            y: 1.55,
          }
        );
      }
    }
  }

  // The slide number, on everything but the title.
  if (slide.layout !== "title") {
    page.addText(`${number}`, {
      align: "right",
      color: theme.muted,
      fontFace: theme.bodyFont,
      fontSize: TYPE.caption - 2,
      h: 0.3,
      w: 0.6,
      x: WIDTH - MARGIN - 0.6,
      y: HEIGHT - 0.45,
    });
  }
}

/**
 * Builds the PowerPoint file.
 *
 * The import is dynamic so the library is only fetched when someone actually
 * downloads a deck — it is not part of the initial bundle.
 */
export async function deckToBlob(deck: Deck, themeId?: string): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const theme = themeFor(themeId ?? deck.theme);
  const pptx = new PptxGenJS();

  pptx.author = "SuperiorAI";
  pptx.layout = "LAYOUT_16x9";
  pptx.subject = deck.title;
  pptx.title = deck.title;

  deck.slides.forEach((slide, index) => {
    drawSlide(pptx, slide, theme, index + 1);
  });

  return (await pptx.write({ outputType: "blob" })) as Blob;
}

/** A file name for the download. */
export function deckFilename(title: string): string {
  const base = title
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 70);

  return `${base || "presentation"}.pptx`;
}
