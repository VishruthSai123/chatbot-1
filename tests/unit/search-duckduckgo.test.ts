import { expect, test } from "@playwright/test";

import {
  isResultUrl,
  parseDuckDuckGoLite,
  parseDuckDuckGoResults,
  unwrapUrl,
} from "../../lib/search/duckduckgo-parse";

/**
 * A Lite result page, whose shape is a table of links and snippets.
 */
const LITE_PAGE = `
<table>
  <tr>
    <td valign="top">1.&nbsp;</td>
    <td>
      <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Freleases&amp;rut=abc" class='result-link'>Releases &middot; vercel/next.js - GitHub</a>
    </td>
  </tr>
  <tr>
    <td>&nbsp;&nbsp;&nbsp;</td>
    <td class='result-snippet'>
      The React Framework. Contribute to vercel/next.js development.
    </td>
  </tr>
  <tr>
    <td valign="top">2.&nbsp;</td>
    <td>
      <a rel="nofollow" href="https://nextjs.org/blog" class='result-link'>Next.js Blog</a>
    </td>
  </tr>
  <tr>
    <td>&nbsp;&nbsp;&nbsp;</td>
    <td class='result-snippet'>News &amp; updates.</td>
  </tr>
</table>
`;

/**
 * A result page shaped like DuckDuckGo's.
 *
 * The class attribute carries more than one class, which is exactly the shape
 * that a naive parser misses.
 */
const PAGE = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://github.com/vercel/next.js/releases">Releases &middot; vercel/next.js - GitHub</a>
    </h2>
    <a class="result__snippet" href="https://github.com/vercel/next.js/releases">The latest releases, <b>including</b> stable and canary builds.</a>
  </div>
</div>

<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnextjs.org%2Fblog&amp;rut=abc">Next.js Blog</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/">News &amp; updates.</a>
  </div>
</div>

<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://github.com/vercel/next.js/releases">A duplicate of the first result</a>
    </h2>
  </div>
</div>

<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">An ad</a>
    </h2>
  </div>
</div>
`;

test.describe("parsing a search result page", () => {
  test("reads the results out of it", () => {
    const hits = parseDuckDuckGoResults(PAGE);

    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe("https://github.com/vercel/next.js/releases");
    expect(hits[0].title).toContain("vercel/next.js");
  });

  test("strips the markup out of a title and a snippet", () => {
    const [first] = parseDuckDuckGoResults(PAGE);

    expect(first.title).not.toContain("<");
    expect(first.snippet).toBe(
      "The latest releases, including stable and canary builds."
    );
  });

  test("unwraps a redirect link into the real destination", () => {
    const hits = parseDuckDuckGoResults(PAGE);

    expect(hits[1].url).toBe("https://nextjs.org/blog");
  });

  test("drops duplicates", () => {
    const urls = parseDuckDuckGoResults(PAGE).map((hit) => hit.url);

    expect(new Set(urls).size).toBe(urls.length);
  });

  test("drops an internal link that is not a result", () => {
    const urls = parseDuckDuckGoResults(PAGE).map((hit) => hit.url);

    expect(urls.some((url) => url.includes("duckduckgo.com"))).toBe(false);
  });

  test("respects the result cap", () => {
    expect(parseDuckDuckGoResults(PAGE, 1)).toHaveLength(1);
  });

  test("an empty page yields nothing rather than throwing", () => {
    expect(parseDuckDuckGoResults("")).toEqual([]);
    expect(
      parseDuckDuckGoResults("<html><body>no results</body></html>")
    ).toEqual([]);
  });
});

test.describe("unwrapping a link", () => {
  test("leaves a normal link alone", () => {
    expect(unwrapUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  test("unwraps a wrapped one", () => {
    expect(
      unwrapUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa")
    ).toBe("https://example.com/a");
  });

  test("a wrapper with no destination is not a link", () => {
    expect(unwrapUrl("//duckduckgo.com/l/?rut=abc")).toBeNull();
    expect(unwrapUrl("not a url")).toBeNull();
  });
});

test.describe("deciding what is a result", () => {
  test("a normal page is", () => {
    expect(isResultUrl("https://example.com")).toBe(true);
  });

  test("an internal or non-web link is not", () => {
    expect(isResultUrl("https://duckduckgo.com/y.js")).toBe(false);
    expect(isResultUrl("javascript:alert(1)")).toBe(false);
    expect(isResultUrl("not a url")).toBe(false);
  });
});

test.describe("parsing a Lite result page", () => {
  test("reads the results out of it", () => {
    const hits = parseDuckDuckGoLite(LITE_PAGE);

    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe("https://github.com/vercel/next.js/releases");
    expect(hits[1].url).toBe("https://nextjs.org/blog");
  });

  test("pairs each snippet with its result", () => {
    const hits = parseDuckDuckGoLite(LITE_PAGE);

    expect(hits[0].snippet).toContain("The React Framework");
    expect(hits[1].snippet).toBe("News & updates.");
  });

  test("strips markup and entities out of a title", () => {
    const [first] = parseDuckDuckGoLite(LITE_PAGE);

    expect(first.title).not.toContain("<");
    expect(first.title).toContain("vercel/next.js");
  });

  test("respects the cap and survives an empty page", () => {
    expect(parseDuckDuckGoLite(LITE_PAGE, 1)).toHaveLength(1);
    expect(parseDuckDuckGoLite("")).toEqual([]);
  });
});
