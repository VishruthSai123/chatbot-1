import { htmlToText } from "@/lib/net/html";

/*
 * Reading a PowerPoint file.
 *
 * A .pptx is a ZIP of XML. The words live in `<a:t>` runs inside each slide's
 * XML, and the speaker notes live in a parallel set of files. That is enough to
 * turn a deck into text a model can read — no Office runtime, no conversion
 * service.
 */

/** The number in `slide12.xml`, so slides sort 2 before 10. */
function slideNumber(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/**
 * The text of one slide's XML.
 *
 * Runs are separate elements, so they are joined with a space; without that a
 * heading split across runs reads as "Quarter ly".
 */
export function parseSlideXml(xml: string): string[] {
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => htmlToText(match[1]))
    .filter(Boolean);

  return runs;
}

/** The text of a whole deck, one section per slide. */
export async function extractPptxText(buffer: Buffer): Promise<{
  slideCount: number;
  text: string;
}> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);

  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  // Reading the slides in parallel is safe: the archive is already in memory.
  const parsed = await Promise.all(
    slidePaths.map(async (path) => {
      const file = zip.file(path);

      return file ? parseSlideXml(await file.async("string")) : [];
    })
  );

  const sections = parsed
    .map((runs, index) =>
      runs.length > 0 ? `Slide ${index + 1}\n${runs.join(" ")}` : ""
    )
    .filter(Boolean);

  return {
    slideCount: slidePaths.length,
    text: sections.join("\n\n"),
  };
}
