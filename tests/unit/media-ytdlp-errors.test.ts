import { expect, test } from "@playwright/test";

import {
  firstUsefulLine,
  isBotCheck,
  isUnavailable,
} from "../../lib/media/ytdlp-errors";

/**
 * The strings yt-dlp actually emits. These are copied from real failures so
 * the classifier is tested against the thing it has to recognise.
 */
const BOT_CHECK =
  "ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.";

const BOT_CHECK_ALT =
  "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.";

const PRIVATE =
  "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video.";

const REMOVED = "ERROR: [youtube] abc: Video unavailable";

test.describe("recognising a bot check", () => {
  test("the standard message", () => {
    expect(isBotCheck(BOT_CHECK)).toBe(true);
  });

  test("the age-gate variant", () => {
    expect(isBotCheck(BOT_CHECK_ALT)).toBe(true);
  });

  test("a private or removed video is not a bot check", () => {
    expect(isBotCheck(PRIVATE)).toBe(false);
    expect(isBotCheck(REMOVED)).toBe(false);
  });

  test("an empty string is not a bot check", () => {
    expect(isBotCheck("")).toBe(false);
  });
});

test.describe("recognising an unavailable video", () => {
  test("private, removed and terminated", () => {
    expect(isUnavailable(PRIVATE)).toBe(true);
    expect(isUnavailable(REMOVED)).toBe(true);
    expect(
      isUnavailable("ERROR: [youtube] abc: This account has been terminated.")
    ).toBe(true);
  });

  test("a bot check is not an unavailable video", () => {
    expect(isUnavailable(BOT_CHECK)).toBe(false);
  });
});

test.describe("choosing the line to show a user", () => {
  test("skips extractor noise and warnings", () => {
    const stderr = [
      "[youtube] Extracting URL: https://youtube.com/watch?v=abc",
      "WARNING: something harmless",
      "ERROR: unable to download video data: HTTP Error 403",
      "This video is not available in your country",
    ].join("\n");

    expect(firstUsefulLine(stderr)).toBe(
      "This video is not available in your country"
    );
  });

  test("returns nothing when there is nothing useful", () => {
    expect(firstUsefulLine("[youtube] Extracting URL: abc")).toBeUndefined();
    expect(firstUsefulLine("")).toBeUndefined();
  });
});
