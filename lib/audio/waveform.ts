/**
 * Waveform peaks.
 *
 * Pure, so the shape of a waveform can be tested without decoding audio.
 *
 * The browser decodes the file and hands over the raw samples; this reduces
 * them to one number per pixel of the waveform. A 90-minute podcast is
 * hundreds of millions of samples and the canvas is a thousand pixels wide, so
 * the reduction is not an optimisation — it is the only way the waveform can
 * exist at all.
 */

export type AudioInfo = {
  /** Duration in seconds. */
  duration?: number;
  /** Bits per second. */
  bitrate?: number;
  /** Channel count. */
  channels?: number;
  /** Container/codec name, e.g. "MPEG-1 Layer 3". */
  codec?: string;
  /** File format, e.g. "mp3" or "flac". */
  format?: string;
  /** Sample rate in Hz. */
  sampleRate?: number;
  /** Embedded title. */
  title?: string;
  /** Embedded artist. */
  artist?: string;
  /** Embedded album. */
  album?: string;
};

/**
 * Reduces samples to one peak per bucket.
 *
 * Each bucket contributes its loudest absolute sample, so a short loud sound
 * inside a quiet passage still shows as a spike. Averaging instead would make
 * a waveform look flat, which is the classic mistake.
 */
export function buildPeaks(samples: Float32Array, buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) {
    return [];
  }

  const peaks: number[] = [];
  const bucketSize = samples.length / buckets;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(samples.length, Math.floor((bucket + 1) * bucketSize));

    let peak = 0;

    for (let index = start; index < end; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) {
        peak = value;
      }
    }

    peaks.push(peak);
  }

  return peaks;
}

/**
 * The loudest peak in a set, used to normalise a waveform to the panel.
 *
 * Without it a quiet recording draws as a flat line down the middle and looks
 * broken; normalising by the loudest peak makes quiet material legible.
 */
export function normalisePeaks(peaks: number[]): number[] {
  const loudest = peaks.reduce((max, peak) => Math.max(max, peak), 0);

  if (loudest <= 0) {
    return peaks;
  }

  return peaks.map((peak) => peak / loudest);
}

/**
 * Formats seconds as a timestamp, e.g. "1:04" or "1:02:03".
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  const padded = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${padded(minutes)}:${padded(rest)}`
    : `${minutes}:${padded(rest)}`;
}

/**
 * Turns a transcript into blocks of "a timecode, then the words that follow it".
 *
 * The raw extraction alternates between a timestamp and the text after it, which
 * renders badly: every sentence ends up in its own paragraph, split away from
 * the timecode that introduces it. Merging them back into one block gives the
 * natural shape — a marker, then the passage it marks.
 */
export function toTranscriptBlocks(
  segments: { text: string; timestamp?: number }[]
): { text: string; timestamp?: number }[] {
  const blocks: { text: string; timestamp?: number }[] = [];

  for (const segment of segments) {
    const previous = blocks.at(-1);

    if (segment.timestamp === undefined) {
      if (previous && previous.timestamp !== undefined) {
        // The words that follow a timecode belong with it.
        previous.text = `${previous.text} ${segment.text}`.trim();
        continue;
      }

      blocks.push({ text: segment.text });
      continue;
    }

    blocks.push({ text: segment.text, timestamp: segment.timestamp });
  }

  return blocks;
}

/**
 * Builds a WebVTT caption track from a transcript.
 *
 * The transcript already carries the timecodes, so it doubles as the caption
 * track for the player: a listener who cannot see the screen, or who is
 * watching on a muted tab, gets the words at the right moment.
 */
export function toVtt(
  segments: { text: string; timestamp?: number }[]
): string {
  const timed = segments.filter((segment) => segment.timestamp !== undefined);

  if (timed.length === 0) {
    return "";
  }

  const stamp = (seconds: number) => {
    const total = Math.max(0, seconds);
    const hours = String(Math.floor(total / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const rest = String(Math.floor(total % 60)).padStart(2, "0");

    return `${hours}:${minutes}:${rest}.000`;
  };

  const cues: string[] = [];

  timed.forEach((segment, index) => {
    const start = segment.timestamp ?? 0;
    const next = timed[index + 1];
    // A cue runs until the next one starts; the last one runs for a minute.
    const end = next?.timestamp ?? start + 60;

    cues.push(
      `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${segment.text}\n`
    );
  });

  return `WEBVTT\n\n${cues.join("\n")}`;
}

/**
 * Finds timestamps in a transcript.
 *
 * Gemini's audio understanding writes them inline — "so the first quarter
 * [00:01:23] showed…" — and this pulls them out so the studio can turn each
 * one into a link that seeks the player.
 */
export function extractTimestamps(
  text: string
): { text: string; timestamp?: number }[] {
  const segments: { text: string; timestamp?: number }[] = [];
  // Matches [mm:ss], [hh:mm:ss] and [m:ss] with an optional fractional part.
  const pattern = /\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]/g;

  let cursor = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    const before = text.slice(cursor, match.index).trim();

    if (before) {
      segments.push({ text: before });
    }

    const parts = match[1].split(":").map(Number);
    const seconds =
      parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];

    segments.push({ text: match[1], timestamp: seconds });

    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  const tail = text.slice(cursor).trim();

  if (tail) {
    segments.push({ text: tail });
  }

  return segments;
}
