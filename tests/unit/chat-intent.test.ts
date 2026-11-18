import { expect, test } from "@playwright/test";

import {
  askedForQuiz,
  askedForSlides,
  askedToEditSlide,
} from "../../lib/ai/chat-intent";

test.describe("deck intent", () => {
  test("recognises a request for a new deck", () => {
    expect(askedForSlides("Create a 5-slide presentation about bicycles")).toBe(
      true
    );
    expect(askedForSlides("Make me a pitch deck for investors")).toBe(true);
    expect(askedForSlides("I need slides for tomorrow's talk")).toBe(true);
    expect(askedForSlides("Turn this report into a PowerPoint")).toBe(true);
  });

  test("does not mistake a slide edit for a new deck", () => {
    const edit = "Make slide 2 shorter and clearer.";

    expect(askedToEditSlide(edit)).toBe(true);
    expect(askedForSlides(edit)).toBe(false);
  });

  test("recognises the ways a slide edit is phrased", () => {
    expect(askedToEditSlide("Change slide 4 to a quote")).toBe(true);
    expect(askedToEditSlide("Rewrite slide 1 in a formal tone")).toBe(true);
    expect(askedToEditSlide("Please update slide 10")).toBe(true);
  });

  test("a create request is not an edit", () => {
    expect(askedToEditSlide("Create a 5-slide presentation")).toBe(false);
    expect(askedToEditSlide("Make a deck about the bicycle")).toBe(false);
  });

  test("ordinary chat is neither", () => {
    expect(askedForSlides("How do bicycles stay upright?")).toBe(false);
    expect(askedToEditSlide("The slide deck was good")).toBe(false);
  });
});

test.describe("quiz intent", () => {
  test("recognises a quiz request", () => {
    expect(askedForQuiz("Quiz me on these notes")).toBe(true);
    expect(askedForQuiz("Test me on chapter 3")).toBe(true);
    expect(askedForQuiz("Make a quiz")).toBe(true);
  });

  test("ordinary chat is not a quiz", () => {
    expect(askedForQuiz("Summarise these notes")).toBe(false);
  });
});
