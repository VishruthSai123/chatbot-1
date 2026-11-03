import { expect, test } from "@playwright/test";

import { decodeEntities, htmlToText } from "../../lib/net/html";

test.describe("turning a page into text", () => {
  test("keeps the words and drops the markup", () => {
    const text = htmlToText(
      "<h1>Quarterly report</h1><p>Revenue rose <strong>eight</strong> percent.</p>"
    );

    expect(text).toBe("Quarterly report Revenue rose eight percent.");
  });

  test("drops scripts, styles and comments", () => {
    const text = htmlToText(
      [
        "<p>Visible.</p>",
        "<script>var secret = 'do not read me';</script>",
        "<style>.a { color: red }</style>",
        "<!-- an editor's note -->",
        "<p>Also visible.</p>",
      ].join("")
    );

    expect(text).toContain("Visible.");
    expect(text).toContain("Also visible.");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("editor");
  });

  test("does not run two paragraphs together", () => {
    expect(htmlToText("<p>First.</p><p>Second.</p>")).toBe("First. Second.");
    expect(htmlToText("Line one<br>Line two")).toBe("Line one Line two");
  });

  test("decodes the entities a page actually uses", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &quot;quoted&quot;</p>")).toBe(
      'Tom & Jerry "quoted"'
    );
    expect(htmlToText("<p>a&nbsp;b</p>")).toBe("a b");
    expect(htmlToText("<p>&#8212; dash</p>")).toBe("— dash");
    expect(htmlToText("<p>&#x2014; dash</p>")).toBe("— dash");
  });

  test("collapses whitespace", () => {
    expect(htmlToText("<p>one   two\n\n three</p>")).toBe("one two three");
  });

  test("an empty page is empty", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<div></div>")).toBe("");
  });

  test("decodes entities without touching unknown ones", () => {
    expect(decodeEntities("&amp; &unknown; &#65;")).toBe("& &unknown; A");
  });
});
