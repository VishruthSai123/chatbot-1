import { expect, test } from "@playwright/test";
import { deckFilename } from "../../lib/slides/pptx";
import { decodeSlidesRef, encodeSlidesRef } from "../../lib/slides/ref";
import {
  type Deck,
  normaliseDeck,
  slideIsComplete,
  slideSummary,
} from "../../lib/slides/schema";
import { themeFor, themeIdFor, themes } from "../../lib/slides/themes";

const deck = (slides: Deck["slides"]): Deck => ({
  slides,
  title: "Quarterly review",
});

test.describe("normalising a generated deck", () => {
  test("keeps a complete deck as it was", () => {
    const input = deck([
      { layout: "title", subtitle: "Q4", title: "Quarterly review" },
      {
        bullets: ["Revenue up 8%", "Costs flat", "Headcount +12"],
        layout: "bullets",
        title: "Highlights",
      },
      { layout: "section", title: "Next steps" },
    ]);

    const output = normaliseDeck(input);

    expect(output.slides).toHaveLength(3);
    expect(output.slides[1].bullets).toHaveLength(3);
  });

  test("trims a headline and drops an empty one", () => {
    const output = normaliseDeck(
      deck([
        { layout: "title", title: "  Quarterly review  " },
        { layout: "section", title: "   " },
      ])
    );

    expect(output.slides).toHaveLength(1);
    expect(output.slides[0].title).toBe("Quarterly review");
  });

  test("caps bullets at five", () => {
    const output = normaliseDeck(
      deck([
        {
          bullets: ["1", "2", "3", "4", "5", "6", "7"],
          layout: "bullets",
          title: "Too many",
        },
      ])
    );

    expect(output.slides[0].bullets).toHaveLength(5);
  });

  test("turns a one-column two-column slide into bullets", () => {
    const output = normaliseDeck(
      deck([
        {
          columns: [{ body: "Some body", heading: "One" }],
          layout: "two-column",
          title: "Only one",
        },
      ])
    );

    expect(output.slides[0].layout).toBe("bullets");
    expect(output.slides[0].bullets?.[0]).toContain("One");
  });

  test("turns a quote with no quotation into a section", () => {
    const output = normaliseDeck(deck([{ layout: "quote", title: "A quote" }]));

    expect(output.slides[0].layout).toBe("section");
  });

  test("turns a stat with no number into a section", () => {
    const output = normaliseDeck(
      deck([{ layout: "stat", title: "A statistic" }])
    );

    expect(output.slides[0].layout).toBe("section");
  });

  test("caps the deck at twenty slides", () => {
    const slides = Array.from({ length: 30 }, (_, index) => ({
      layout: "section" as const,
      title: `Slide ${index}`,
    }));

    expect(normaliseDeck(deck(slides)).slides).toHaveLength(20);
  });

  test("an empty subtitle becomes undefined", () => {
    const output = normaliseDeck({
      ...deck([{ layout: "title", title: "Title" }]),
      subtitle: "   ",
    });

    expect(output.subtitle).toBeUndefined();
  });
});

test.describe("whether a slide is complete", () => {
  test("bullets need at least one bullet", () => {
    expect(slideIsComplete({ layout: "bullets", title: "x" })).toBe(false);
    expect(
      slideIsComplete({ bullets: ["a"], layout: "bullets", title: "x" })
    ).toBe(true);
  });

  test("two columns need exactly two", () => {
    expect(
      slideIsComplete({
        columns: [{ body: "b", heading: "h" }],
        layout: "two-column",
        title: "x",
      })
    ).toBe(false);
  });

  test("a quote needs its text", () => {
    expect(slideIsComplete({ layout: "quote", title: "x" })).toBe(false);
    expect(
      slideIsComplete({ layout: "quote", quote: { text: "hi" }, title: "x" })
    ).toBe(true);
  });

  test("title and section are always complete", () => {
    expect(slideIsComplete({ layout: "title", title: "x" })).toBe(true);
    expect(slideIsComplete({ layout: "section", title: "x" })).toBe(true);
  });
});

test.describe("describing a slide", () => {
  test("says what kind of slide it is", () => {
    expect(slideSummary({ layout: "section", title: "x" })).toBe("Section");
    expect(
      slideSummary({ bullets: ["a", "b"], layout: "bullets", title: "x" })
    ).toBe("2 points");
    expect(
      slideSummary({
        layout: "stat",
        stat: { label: "l", value: "42%" },
        title: "x",
      })
    ).toBe("42%");
  });
});

test.describe("the deck descriptor", () => {
  test("round-trips", () => {
    const ref = {
      deck: deck([{ layout: "title", title: "Quarterly review" }]),
      theme: "mono",
      title: "Quarterly review",
    };

    expect(decodeSlidesRef(encodeSlidesRef(ref))?.deck.title).toBe(
      "Quarterly review"
    );
  });

  test("refuses anything that is not a deck", () => {
    expect(decodeSlidesRef("plain text")).toBeNull();
    expect(decodeSlidesRef("slides-ref:not json")).toBeNull();
    expect(
      decodeSlidesRef('slides-ref:{"deck":{"slides":[]}}')?.deck.slides
    ).toEqual([]);
    expect(decodeSlidesRef(null)).toBeNull();
  });
});

test.describe("themes", () => {
  test("falls back to mono for an unknown id", () => {
    expect(themeIdFor("nonsense")).toBe("mono");
    expect(themeFor("nonsense").name).toBe("Mono");
  });

  test("every theme has the colours a slide needs", () => {
    for (const theme of Object.values(themes)) {
      expect(theme.background).toMatch(/^[0-9A-F]{6}$/i);
      expect(theme.text).toMatch(/^[0-9A-F]{6}$/i);
      expect(theme.accent).toMatch(/^[0-9A-F]{6}$/i);
      expect(theme.headingFont.length).toBeGreaterThan(0);
    }
  });
});

test.describe("naming the download", () => {
  test("keeps a readable title", () => {
    expect(deckFilename("Quarterly review")).toBe("Quarterly-review.pptx");
  });

  test("strips characters a file system would object to", () => {
    expect(deckFilename('bad/name: "here"')).toBe("badname-here.pptx");
  });

  test("falls back when there is no title", () => {
    expect(deckFilename("")).toBe("presentation.pptx");
  });
});
