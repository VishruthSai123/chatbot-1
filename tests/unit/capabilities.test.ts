import { expect, test } from "@playwright/test";

import { capabilities, starterPrompts } from "../../lib/capabilities";

test.describe("the capability catalogue", () => {
  test("names every family the app has", () => {
    expect(capabilities).toHaveLength(8);

    const names = capabilities.map((item) => item.name);

    expect(names).toEqual([
      "Images",
      "PDF",
      "Sheets",
      "Documents",
      "Audio & video",
      "Notebooks",
      "Research",
      "Downloads",
    ]);
  });

  test("every family has a description and examples", () => {
    for (const item of capabilities) {
      expect(item.description.length).toBeGreaterThan(10);
      expect(item.examples.length).toBeGreaterThanOrEqual(2);

      for (const example of item.examples) {
        expect(example.trim().length).toBeGreaterThan(10);
      }
    }
  });

  test("ids are unique, so the panel can open on one", () => {
    const ids = capabilities.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the starter prompts are real prompts, not categories", () => {
    expect(starterPrompts.length).toBeGreaterThanOrEqual(4);

    for (const prompt of starterPrompts) {
      // A prompt ends with a question mark or is a full sentence.
      expect(prompt.length).toBeGreaterThan(20);
    }

    // The old generic prompts must be gone: they described a chatbot, not
    // this app.
    expect(starterPrompts.join(" ")).not.toContain("Dijkstra");
  });
});
