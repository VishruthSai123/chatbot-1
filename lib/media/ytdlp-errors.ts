/*
 * Reading yt-dlp's failures.
 *
 * Pure, so the classification can be tested against the exact strings yt-dlp
 * emits rather than against a live YouTube request.
 */

/**
 * Whether yt-dlp's failure is YouTube's bot check.
 *
 * Only this error is worth rotating player clients or asking for a session; a
 * private video or a dead link would fail the same way on every client.
 */
export function isBotCheck(stderr: string): boolean {
  return /sign in to confirm|confirm you'?re not a bot|not a bot|bot check/i.test(
    stderr
  );
}

/** Whether the failure is a private, removed or unavailable video. */
export function isUnavailable(stderr: string): boolean {
  return /private video|video unavailable|has been removed|this video is not available|account has been terminated/i.test(
    stderr
  );
}

/**
 * The first line of yt-dlp's error output that is worth showing a user.
 *
 * yt-dlp prefixes most of its output with `[extractor]` context lines and
 * warnings, which mean nothing to someone who just pasted a link.
 */
export function firstUsefulLine(stderr: string): string | undefined {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("[") &&
        !line.startsWith("WARNING") &&
        !line.startsWith("ERROR: unable to download")
    );

  return lines[0];
}
