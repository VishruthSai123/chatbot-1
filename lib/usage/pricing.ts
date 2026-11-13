export type PriceLane = "standard" | "flex" | "batch" | "priority";

export type PriceRow = {
  model: string;
  lane: PriceLane;
  inputPer1M: number;
  cachedPer1M: number;
  outputPer1M: number;
  liveAudioInPerMin?: number;
  liveAudioOutPerMin?: number;
  liveVideoInPerMin?: number;
  effectiveFrom: string;
};

/**
 * Versioned defaults. The database PriceBook is the source of truth at runtime;
 * these values are the seed and the safe fallback if the table is unavailable.
 *
 * Prices are USD per 1M tokens unless the field says PerMin.
 */
export const DEFAULT_PRICES: PriceRow[] = [
  {
    cachedPer1M: 0.025,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.25,
    lane: "standard",
    model: "gemini-3.1-flash-lite",
    outputPer1M: 1.5,
  },
  {
    cachedPer1M: 0.0125,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.125,
    lane: "flex",
    model: "gemini-3.1-flash-lite",
    outputPer1M: 0.75,
  },
  {
    cachedPer1M: 0.03,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.3,
    lane: "standard",
    model: "gemini-3.5-flash-lite",
    outputPer1M: 2.5,
  },
  {
    cachedPer1M: 0.015,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.15,
    lane: "flex",
    model: "gemini-3.5-flash-lite",
    outputPer1M: 1.25,
  },
  {
    cachedPer1M: 0.075,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.75,
    lane: "standard",
    model: "gemini-3.8-flash",
    outputPer1M: 3.75,
  },
  {
    cachedPer1M: 0.0375,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.375,
    lane: "flex",
    model: "gemini-3.8-flash",
    outputPer1M: 1.875,
  },
  {
    cachedPer1M: 0,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.5,
    lane: "standard",
    liveAudioInPerMin: 0.0045,
    liveAudioOutPerMin: 0.018,
    liveVideoInPerMin: 0.002,
    model: "gemini-2.5-flash-native-audio-latest",
    outputPer1M: 2,
  },
  {
    cachedPer1M: 0,
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    inputPer1M: 0.75,
    lane: "standard",
    liveAudioInPerMin: 0.005,
    liveAudioOutPerMin: 0.018,
    liveVideoInPerMin: 0.002,
    model: "gemini-3.8-live",
    outputPer1M: 4.5,
  },
];

export function normalizeModel(model: string): string {
  return model.replace(/^models\//, "").trim();
}

export function priceFor(
  model: string,
  lane: PriceLane,
  at: Date = new Date()
): PriceRow {
  const normalized = normalizeModel(model);
  const atMs = at.getTime();
  const matches = DEFAULT_PRICES.filter(
    (row) =>
      row.model === normalized &&
      row.lane === lane &&
      new Date(row.effectiveFrom).getTime() <= atMs
  );
  if (matches.length > 0) {
    return matches.sort(
      (a, b) =>
        new Date(b.effectiveFrom).getTime() -
        new Date(a.effectiveFrom).getTime()
    )[0];
  }

  // Fall back to the standard lane for the model, then to the first row.
  return (
    DEFAULT_PRICES.find((row) => row.model === normalized) ?? DEFAULT_PRICES[0]
  );
}

export function chatCost({
  cachedTokens,
  inputTokens,
  lane,
  model,
  outputTokens,
}: {
  cachedTokens: number;
  inputTokens: number;
  lane: PriceLane;
  model: string;
  outputTokens: number;
}): number {
  const price = priceFor(model, lane);
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const input = (uncached * price.inputPer1M) / 1_000_000;
  const cached = (Math.max(0, cachedTokens) * price.cachedPer1M) / 1_000_000;
  const output = (Math.max(0, outputTokens) * price.outputPer1M) / 1_000_000;
  return round6(input + cached + output);
}

/**
 * Live cost estimate.
 *
 * The session ledger knows total seconds, not a reliable split between user
 * speech and model speech. Use a 50/50 default, which is conservative for a
 * normal conversation, and allow the caller to override the ratio when the
 * client reports it.
 */
export function liveCost({
  audioInRatio = 0.5,
  lane = "standard",
  model,
  seconds,
  videoSeconds = 0,
}: {
  audioInRatio?: number;
  lane?: PriceLane;
  model: string;
  seconds: number;
  videoSeconds?: number;
}): number {
  const price = priceFor(model, lane);
  const safeSeconds = Math.max(0, seconds);
  const inSeconds = safeSeconds * clamp(audioInRatio, 0, 1);
  const outSeconds = safeSeconds - inSeconds;
  const audioIn = (inSeconds / 60) * (price.liveAudioInPerMin ?? 0);
  const audioOut = (outSeconds / 60) * (price.liveAudioOutPerMin ?? 0);
  const video =
    (Math.max(0, videoSeconds) / 60) * (price.liveVideoInPerMin ?? 0);
  return round6(audioIn + audioOut + video);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Conservative proxied-media cost: storage + egress + proxy bandwidth. The
 * actual supplier bill is reconciled monthly; this keeps the per-event ledger
 * from pretending downloads are free.
 */
export function downloadCost(bytes: number): number {
  const gb = Math.max(0, bytes) / 1_000_000_000;
  return round6(gb * 5.18);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
