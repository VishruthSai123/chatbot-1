import { expect, test } from "@playwright/test";

import {
  buildPeaks,
  extractTimestamps,
  formatTimestamp,
  normalisePeaks,
  toTranscriptBlocks,
  toVtt,
} from "../../lib/audio/waveform";

test.describe("building peaks", () => {
  test("reduces samples to one peak per bucket", () => {
    const samples = new Float32Array(100);

    samples.fill(0.1, 0, 50);
    samples.fill(0.9, 50, 100);

    const peaks = buildPeaks(samples, 2);

    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(0.1);
    expect(peaks[1]).toBeCloseTo(0.9);
  });

  test("keeps a short loud spike instead of averaging it away", () => {
    const samples = new Float32Array(1000).fill(0.01);
    samples[500] = 1;

    const peaks = buildPeaks(samples, 10);

    // The bucket holding the spike is loud even though almost all of it is quiet.
    expect(Math.max(...peaks)).toBeCloseTo(1);
  });

  test("an empty input produces no peaks", () => {
    expect(buildPeaks(new Float32Array(0), 10)).toEqual([]);
  });

  test("a zero-bucket request produces no peaks", () => {
    expect(buildPeaks(new Float32Array(10), 0)).toEqual([]);
  });
});

test.describe("normalising peaks", () => {
  test("scales the loudest peak to one", () => {
    expect(normalisePeaks([0.25, 0.5, 1])).toEqual([0.25, 0.5, 1]);
  });

  test("leaves a silent recording alone", () => {
    expect(normalisePeaks([0, 0])).toEqual([0, 0]);
  });
});

test.describe("formatting timestamps", () => {
  test("formats minutes and seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(599)).toBe("9:59");
  });

  test("adds hours when there are any", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  test("survives nonsense input", () => {
    expect(formatTimestamp(-5)).toBe("0:00");
    expect(formatTimestamp(Number.NaN)).toBe("0:00");
  });
});

test.describe("extracting timestamps", () => {
  test("pulls the timecodes out of a transcript", () => {
    const segments = extractTimestamps(
      "Welcome back. [00:01:23] The first number was 42. [00:02:05] And the second was 17."
    );

    const timed = segments.filter((segment) => segment.timestamp !== undefined);

    expect(timed).toHaveLength(2);
    expect(timed[0].timestamp).toBe(83);
    expect(timed[1].timestamp).toBe(125);
  });

  test("a transcript with no timecodes is one block of text", () => {
    const segments = extractTimestamps("Just words, no markers.");

    expect(segments).toHaveLength(1);
    expect(segments[0].timestamp).toBeUndefined();
  });

  test("handles the mm:ss form as well as hh:mm:ss", () => {
    const segments = extractTimestamps("[01:30] halfway");

    expect(
      segments.find((segment) => segment.timestamp !== undefined)?.timestamp
    ).toBe(90);
  });
});

test.describe("transcript blocks", () => {
  test("merges the words that follow a timecode into its block", () => {
    const blocks = toTranscriptBlocks(
      extractTimestamps(
        "Intro words. [00:01] The important part. [00:05] Another part."
      )
    );

    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toBe("Intro words.");
    // "[00:01]" is mm:ss — zero minutes, one second.
    expect(blocks[1].timestamp).toBe(1);
    expect(blocks[1].text).toContain("The important part.");
  });

  test("keeps the timecode out of the passage text", () => {
    const blocks = toTranscriptBlocks(
      extractTimestamps("[00:01] The important part.")
    );

    // The marker lives in `timestamp`; the passage is the words alone. Mixing
    // the two is what made the panel print every passage twice.
    expect(blocks[0].text).toBe("The important part.");
    expect(blocks[0].text).not.toContain("00:01");
    expect(blocks[0].timestamp).toBe(1);
  });

  test("a timecode with no words after it still gets a block", () => {
    const blocks = toTranscriptBlocks(extractTimestamps("[00:07]"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].timestamp).toBe(7);
    expect(blocks[0].text).toBe("");
  });
});

test.describe("caption track", () => {
  test("produces a WebVTT track from the timed blocks", () => {
    const vtt = toVtt(
      toTranscriptBlocks(
        extractTimestamps("[00:01] Hello there. [00:05] Goodbye.")
      )
    );

    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:05.000");
    expect(vtt).toContain("Hello there.");
  });

  test("the cue carries the words, not just the clock", () => {
    const vtt = toVtt(
      toTranscriptBlocks(extractTimestamps("[00:01] Hello there. [00:05] Bye."))
    );

    // The cue is a number, a timing line, and the passage itself. The passage
    // must not be the timecode it was marked with.
    const cue = vtt.split("\n\n").at(1)?.trim().split("\n") ?? [];
    expect(cue.at(-1)).toBe("Hello there.");
  });

  test("a timecode with no words still gets a readable cue", () => {
    const vtt = toVtt(toTranscriptBlocks(extractTimestamps("[00:07]")));

    expect(vtt).toContain("00:00:07.000");
    expect(vtt.split("\n").at(-2)?.trim()).toBe("0:07");
  });

  test("a transcript with no timecodes makes no track", () => {
    expect(toVtt(toTranscriptBlocks(extractTimestamps("No markers.")))).toBe(
      ""
    );
  });
});
