import { expect, test } from "@playwright/test";

import {
  isGroundingRedirect,
  sourceHost,
  sourceLabel,
  toGroundingSources,
} from "../../lib/ai/search/sources";

const REDIRECT =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFONQXLnD-pPhpC5kDnHvPmeMYDxmJM4J5ix";

test.describe("normalising grounded sources", () => {
  test("keeps the url and title of each source", () => {
    const sources = toGroundingSources([
      { title: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/PDF" },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("en.wikipedia.org");
    expect(sources[0].url).toBe("https://en.wikipedia.org/wiki/PDF");
  });

  test("drops a duplicate url", () => {
    const sources = toGroundingSources([
      { title: "a.com", url: "https://a.com" },
      { title: "a.com again", url: "https://a.com" },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("a.com");
  });

  test("drops a source with no url", () => {
    const sources = toGroundingSources([
      { title: "no url" },
      { title: "ok", url: "https://ok.com" },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://ok.com");
  });

  test("survives something that is not an array", () => {
    expect(toGroundingSources(null)).toEqual([]);
    expect(toGroundingSources(undefined)).toEqual([]);
    expect(toGroundingSources("nope")).toEqual([]);
  });
});

test.describe("showing the site a source belongs to", () => {
  test("recognises a grounding redirect", () => {
    expect(isGroundingRedirect(REDIRECT)).toBe(true);
    expect(isGroundingRedirect("https://en.wikipedia.org/wiki/PDF")).toBe(
      false
    );
  });

  test("shows the title for a grounding redirect", () => {
    // The redirect host tells the reader nothing; the title is the site.
    expect(sourceHost({ title: "en.wikipedia.org", url: REDIRECT })).toBe(
      "en.wikipedia.org"
    );
  });

  test("shows the real host for an ordinary url", () => {
    expect(
      sourceHost({ title: "A page title", url: "https://en.wikipedia.org/x" })
    ).toBe("en.wikipedia.org");
  });

  test("falls back to the host when a redirect has no title", () => {
    // The marker sits in the path, so the host is the only thing left to show.
    expect(sourceHost({ url: REDIRECT })).toBe(
      "vertexaisearch.cloud.google.com"
    );
  });

  test("labels a source by its title", () => {
    expect(
      sourceLabel({ title: "Reuters", url: "https://reuters.com/x" })
    ).toBe("Reuters");
  });

  test("labels a source by its host when it has no title", () => {
    expect(sourceLabel({ url: "https://www.reuters.com/x" })).toBe(
      "reuters.com"
    );
  });

  test("a malformed url does not throw", () => {
    expect(sourceLabel({ url: "not a url" })).toBe("not a url");
  });
});
