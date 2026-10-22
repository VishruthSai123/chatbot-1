/**
 * Reading WebVTT caption files.
 *
 * Pure, because the fiddly part of a subtitle file is not the format but the
 * overlap: YouTube's auto-generated captions scroll, so the same sentence
 * appears again and again as the caption box grows. Taking the raw cues would
 * give a transcript where every line is repeated two or three times.
 */

/** One caption cue. */
export type VttCue = {
  /** When the cue starts, in seconds. */
  start: number;
  /** The text of the cue. */
  text: string;
};

const TIMESTAMP = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})|-->/;

/**
 * Parses a WebVTT file into its cues.
 */
export function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }

    // A block is: an optional cue number, a timestamp line, then the text.
    const timestampIndex = lines.findIndex((line) => line.includes("-->"));

    if (timestampIndex === -1) {
      continue;
    }

    const start = parseTimestamp(lines[timestampIndex]);
    const text = lines
      .slice(timestampIndex + 1)
      .join(" ")
      .trim();

    if (start === null || !text) {
      continue;
    }

    cues.push({ start, text });
  }

  return cues;
}

/**
 * Parses the start of a timestamp line.
 */
function parseTimestamp(line: string): number | null {
  const match = TIMESTAMP.exec(line);

  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds, fraction] = match;

  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(`0.${fraction ?? 0}`)
  );
}

/**
 * Turns caption cues into a transcript, dropping the repeated lines.
 *
 * The auto-generated captions repeat a line while it stays on screen, and then
 * show it again with more text after it. So each cue is compared with the one
 * before it: whatever the new cue adds is kept, and whatever it repeats is
 * dropped.
 */
export function cuesToTranscript(cues: VttCue[]): string {
  const parts: string[] = [];
  let previous = "";

  for (const cue of cues) {
    const text = cue.text.trim();

    if (!text) {
      continue;
    }

    if (previous) {
      // The cue repeats the previous line and adds to it.
      if (text.startsWith(previous)) {
        const addition = text.slice(previous.length).trim();

        if (addition) {
          parts.push(addition);
          previous = text;
        }

        continue;
      }

      // The cue is entirely inside the previous line — a repeat.
      if (previous.startsWith(text)) {
        continue;
      }
    }

    parts.push(text);
    previous = text;
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A transcript with the timecodes inline, in the same shape the audio studio
 * produces — so both kinds of source can be cited by time.
 */
export function cuesToTimestampedTranscript(cues: VttCue[]): string {
  const parts: string[] = [];
  let previous = "";

  for (const cue of cues) {
    const text = cue.text.trim();

    if (!text) {
      continue;
    }

    if (previous) {
      if (text.startsWith(previous)) {
        const addition = text.slice(previous.length).trim();

        if (addition) {
          parts.push(`[${formatCueTime(cue.start)}] ${addition}`);
          previous = text;
        }

        continue;
      }

      if (previous.startsWith(text)) {
        continue;
      }
    }

    parts.push(`[${formatCueTime(cue.start)}] ${text}`);
    previous = text;
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** `HH:MM:SS` — the form the studio's caption track and seek links expect. */
function formatCueTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const rest = String(total % 60).padStart(2, "0");

  return `${hours}:${minutes}:${rest}`;
}
