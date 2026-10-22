import { expect, test } from "@playwright/test";

import {
  cuesToTimestampedTranscript,
  cuesToTranscript,
  parseVtt,
} from "../../lib/media/vtt";

const SCROLLING = `WEBVTT

00:00:01.000 --> 00:00:03.000
All right, so here we are

00:00:03.000 --> 00:00:05.000
All right, so here we are, in front of the elephants

00:00:05.000 --> 00:00:07.000
All right, so here we are, in front of the elephants, and the
cool thing about these guys

00:00:07.000 --> 00:00:09.000
the cool thing about these guys is that they have really long trunks
`;

test.describe("parsing a caption file", () => {
  test("reads the cues and their times", () => {
    const cues = parseVtt(SCROLLING);

    expect(cues).toHaveLength(4);
    expect(cues[0].start).toBe(1);
    expect(cues[0].text).toBe("All right, so here we are");
  });

  test("joins the lines of a cue", () => {
    const cues = parseVtt(SCROLLING);

    expect(cues[2].text).toContain("cool thing about these guys");
  });

  test("ignores a file with no cues", () => {
    expect(parseVtt("WEBVTT\n\n")).toHaveLength(0);
    expect(parseVtt("")).toHaveLength(0);
  });

  test("skips a cue with no text", () => {
    expect(parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n")).toHaveLength(
      0
    );
  });
});

test.describe("turning cues into a transcript", () => {
  test("drops the repeated lines of a scrolling caption", () => {
    const transcript = cuesToTranscript(parseVtt(SCROLLING));

    // "All right, so here we are" appears once, not four times.
    const occurrences =
      transcript.split("All right, so here we are").length - 1;

    expect(occurrences).toBe(1);
    expect(transcript).toContain("in front of the elephants");
    expect(transcript).toContain("long trunks");
  });

  test("keeps the order of the cues", () => {
    const transcript = cuesToTranscript(parseVtt(SCROLLING));

    expect(transcript.indexOf("here we are")).toBeLessThan(
      transcript.indexOf("long trunks")
    );
  });

  test("a caption that repeats entirely is skipped", () => {
    const cues = parseVtt(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSame thing\n\n00:00:02.000 --> 00:00:03.000\nSame thing\n"
    );

    expect(cuesToTranscript(cues)).toBe("Same thing");
  });
});

test.describe("a transcript with timecodes", () => {
  test("marks each passage with the time it starts", () => {
    const transcript = cuesToTimestampedTranscript(parseVtt(SCROLLING));

    expect(transcript).toContain("[00:00:01]");
    expect(transcript).toContain("[00:00:07]");
  });

  test("a cue with no text produces no marker", () => {
    expect(cuesToTimestampedTranscript([])).toBe("");
  });
});
