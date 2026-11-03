import { expect, test } from "@playwright/test";

import {
  isImageType,
  isMediaType,
  mediaTypeFor,
} from "../../lib/attachments/media";
import { parseSlideXml } from "../../lib/doc/pptx";

test.describe("recognising a file by its name", () => {
  test("maps the types the upload accepts", () => {
    expect(mediaTypeFor("report.pdf")).toBe("application/pdf");
    expect(mediaTypeFor("photo.PNG")).toBe("image/png");
    expect(mediaTypeFor("notes.md")).toBe("text/markdown");
    expect(mediaTypeFor("data.csv")).toBe("text/csv");
    expect(mediaTypeFor("book.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(mediaTypeFor("deck.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(mediaTypeFor("talk.mp3")).toBe("audio/mpeg");
    expect(mediaTypeFor("clip.mp4")).toBe("video/mp4");
  });

  test("an unknown extension is a binary, not a guess", () => {
    expect(mediaTypeFor("archive.bin")).toBe("application/octet-stream");
    expect(mediaTypeFor("noextension")).toBe("application/octet-stream");
  });

  test("classifies what the reader treats specially", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("application/pdf")).toBe(false);
    expect(isMediaType("audio/mpeg")).toBe(true);
    expect(isMediaType("video/mp4")).toBe(true);
    expect(isMediaType("text/csv")).toBe(false);
  });
});

test.describe("reading a slide's XML", () => {
  test("pulls the words out of their runs", () => {
    const xml = `
      <p:sld>
        <a:p><a:r><a:t>Quarterly</a:t></a:r><a:r><a:t>review</a:t></a:r></a:p>
        <a:p><a:r><a:t>Revenue up 8%</a:t></a:r></a:p>
      </p:sld>`;

    expect(parseSlideXml(xml)).toEqual([
      "Quarterly",
      "review",
      "Revenue up 8%",
    ]);
  });

  test("decodes the entities a deck actually contains", () => {
    expect(
      parseSlideXml("<a:p><a:r><a:t>Tom &amp; Jerry</a:t></a:r></a:p>")
    ).toEqual(["Tom & Jerry"]);
  });

  test("ignores empty runs", () => {
    expect(parseSlideXml("<a:t></a:t><a:t>Real</a:t>")).toEqual(["Real"]);
  });

  test("a slide with no text yields nothing", () => {
    expect(parseSlideXml("<p:sld></p:sld>")).toEqual([]);
  });
});

test.describe("reading a whole deck", () => {
  test("finds every slide, in order", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    zip.file(
      "ppt/slides/slide2.xml",
      "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>"
    );
    zip.file(
      "ppt/slides/slide1.xml",
      "<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>"
    );
    zip.file("ppt/slides/_rels/slide1.xml.rels", "<Relationships/>");

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const { extractPptxText } = await import("../../lib/doc/pptx");
    const result = await extractPptxText(buffer);

    expect(result.slideCount).toBe(2);
    expect(result.text.indexOf("First")).toBeLessThan(
      result.text.indexOf("Second")
    );
    expect(result.text).toContain("Slide 1");
  });

  test("a deck with no text yields nothing rather than throwing", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    zip.file("ppt/slides/slide1.xml", "<p:sld></p:sld>");

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const { extractPptxText } = await import("../../lib/doc/pptx");

    expect((await extractPptxText(buffer)).text).toBe("");
  });
});
