import { expect, test } from "@playwright/test";

import {
  classifyFiles,
  formatExpression,
  hasCombinedFormat,
} from "../../lib/media/format";

/**
 * The streams YouTube publishes for a video: a picture with no sound, and a
 * sound with no picture.
 */
const YOUTUBE_FORMATS = [
  { acodec: "none", format_id: "137", height: 1080, vcodec: "avc1.640028" },
  { acodec: "none", format_id: "248", height: 1080, vcodec: "vp9" },
  { acodec: "opus", format_id: "251", vcodec: "none" },
  { acodec: "mp4a.40.2", format_id: "140", vcodec: "none" },
];

/**
 * The single stream Instagram, TikTok and Facebook publish.
 */
const COMBINED_FORMATS = [
  {
    acodec: "aac",
    format_id: "0",
    height: 720,
    vcodec: "avc1.4d401f",
  },
];

test.describe("reading what a platform publishes", () => {
  test("a platform that publishes the picture and the sound apart", () => {
    expect(hasCombinedFormat(YOUTUBE_FORMATS)).toBe(false);
  });

  test("a platform that publishes one file with both", () => {
    expect(hasCombinedFormat(COMBINED_FORMATS)).toBe(true);
  });

  test("a stream with no picture is not a combined file", () => {
    // An audio-only stream has a sound but no picture, so it is not a file
    // carrying both.
    expect(
      hasCombinedFormat([
        { acodec: "opus", format_id: "251", height: null, vcodec: "none" },
      ])
    ).toBe(false);
  });

  test("a platform that publishes nothing at all", () => {
    expect(hasCombinedFormat([])).toBe(false);
  });
});

test.describe("choosing what to download", () => {
  test("audio asks for the original stream, never an extraction", () => {
    // "-x" would shell out to FFmpeg, which this deployment does not have.
    const expression = formatExpression({ combined: false, format: "audio" });

    expect(expression).toBe("bestaudio/best");
    expect(expression).not.toContain("-x");
  });

  test("a combined platform is asked for one file with both streams", () => {
    const expression = formatExpression({
      combined: true,
      format: "video",
      quality: 720,
    });

    expect(expression).toContain("[vcodec!=none]");
    expect(expression).toContain("[acodec!=none]");
    // A single file, not two to be joined.
    expect(expression).not.toContain("+");
  });

  test("a separated platform is asked for both parts", () => {
    const expression = formatExpression({
      combined: false,
      format: "video",
      quality: 720,
    });

    expect(expression).toContain("bestvideo[height<=720]");
    expect(expression).toContain("+bestaudio");
  });

  test("the quality cap is a preference, not a promise", () => {
    const expression = formatExpression({
      combined: true,
      format: "video",
      quality: 720,
    });

    // The first alternative is capped…
    expect(expression.split("/")[0]).toContain("height<=720");
    // …and the second is any file with both streams, so a video offered only
    // at 360p still downloads.
    expect(expression.split("/")[1]).toBe("best[vcodec!=none][acodec!=none]");
  });

  test("the default cap is 1080", () => {
    expect(formatExpression({ combined: true, format: "video" })).toContain(
      "height<=1080"
    );
  });
});

test.describe("telling the downloaded files apart", () => {
  test("a picture and a sound are told apart", () => {
    const classified = classifyFiles(["137.mp4", "251.webm"], YOUTUBE_FORMATS);

    expect(classified).toHaveLength(2);
    expect(classified[0].kind).toBe("video");
    expect(classified[1].kind).toBe("audio");
  });

  test("a file carrying both is recognised", () => {
    const classified = classifyFiles(["0.mp4"], COMBINED_FORMATS);

    expect(classified[0].kind).toBe("combined");
  });

  test("a format id that contains a dot is still read correctly", () => {
    const classified = classifyFiles(
      ["dash-0.1.webm"],
      [{ acodec: "opus", format_id: "dash-0.1", vcodec: "none" }]
    );

    // The extension is after the last dot, so the rest is the format id —
    // dots and all.
    expect(classified[0].filename).toBe("dash-0.1.webm");
    expect(classified[0].kind).toBe("audio");
  });

  test("two formats asked for at once are told apart", () => {
    // The downloader keeps the individual format id after the ".f" when more
    // than one stream was requested.
    const classified = classifyFiles(
      ["137+251.f137.mp4", "137+251.f251.webm"],
      YOUTUBE_FORMATS
    );

    expect(classified[0].kind).toBe("video");
    expect(classified[1].kind).toBe("audio");
  });

  test("a file the platform did not describe is taken at face value", () => {
    const classified = classifyFiles(["unknown.mp4"], []);

    expect(classified[0].kind).toBe("combined");
  });
});
