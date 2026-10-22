"use client";

/**
 * Turning a downloaded audio track into an MP3, in the browser.
 *
 * The alternative is bundling FFmpeg in the download function: about 80 MB of
 * binary, a much larger cold start, and a much bigger deployment — to produce a
 * 128 kbps MP3 that a browser can do on its own.
 *
 * The browser already has the audio: it was just downloaded. `decodeAudioData`
 * turns it into samples, and a pure-JavaScript MP3 encoder turns those samples
 * into a file. Nothing is uploaded, nothing is stored, and the server never
 * touches the audio at all.
 *
 * The trade-off is honest: the browser's encoder is slower than FFmpeg and the
 * result is a little larger. For a song, that is the right trade.
 */

import { Mp3Encoder } from "@breezystack/lamejs";

/** The bitrate the MP3 is written at. */
const BITRATE_KBPS = 128;

/** The sample rate the encoder is given. */
const SAMPLE_RATE = 44_100;

/** The channel count MP3 supports. */
const CHANNELS = 2;

export type EncodeProgress = {
  /** 0–1. */
  progress: number;
  stage: "decoding" | "encoding" | "done";
};

export type EncodedAudio = {
  blob: Blob;
  /** How long the audio is, in seconds. */
  duration: number;
  filename: string;
};

/**
 * Encodes an audio file as MP3.
 *
 * The audio is fetched as bytes and decoded by the Web Audio API, which handles
 * the containers the platforms actually serve: AAC in MP4, Opus in WebM, and
 * WAV.
 */
export async function encodeAsMp3({
  onProgress,
  sourceUrl,
  title,
}: {
  onProgress?: (progress: EncodeProgress) => void;
  sourceUrl: string;
  title: string;
}): Promise<EncodedAudio> {
  onProgress?.({ progress: 0, stage: "decoding" });

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error("The audio could not be fetched.");
  }

  const bytes = await response.arrayBuffer();

  // The AudioContext is a browser API, so this has to happen on the client.
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(bytes);
  await context.close();

  onProgress?.({ progress: 0.2, stage: "encoding" });

  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;

  const encoder = new Mp3Encoder(CHANNELS, SAMPLE_RATE, BITRATE_KBPS);
  const sampleBlockSize = 1152;
  const leftData = new Int16Array(left.length);
  const rightData = new Int16Array(right.length);

  for (let index = 0; index < left.length; index += 1) {
    const l = Math.max(-1, Math.min(1, left[index] ?? 0));
    const r = Math.max(-1, Math.min(1, right[index] ?? 0));

    leftData[index] = l < 0 ? l * 0x80_00 : l * 0x7f_ff;
    rightData[index] = r < 0 ? r * 0x80_00 : r * 0x7f_ff;
  }

  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < leftData.length; offset += sampleBlockSize) {
    const leftChunk = leftData.subarray(offset, offset + sampleBlockSize);
    const rightChunk = rightData.subarray(offset, offset + sampleBlockSize);

    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);

    if (encoded.length > 0) {
      chunks.push(new Uint8Array(encoded));
    }

    if (offset % (sampleBlockSize * 50) === 0) {
      onProgress?.({
        progress: 0.2 + 0.75 * (offset / leftData.length),
        stage: "encoding",
      });
    }
  }

  const flushed = encoder.flush();

  if (flushed.length > 0) {
    chunks.push(new Uint8Array(flushed));
  }

  onProgress?.({ progress: 1, stage: "done" });

  const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });

  return {
    blob,
    duration: decoded.duration,
    filename: `${sanitiseTitle(title)}.mp3`,
  };
}

/** A file name that is safe on every platform. */
function sanitiseTitle(title: string): string {
  const cleaned = title
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);

  return cleaned || "audio";
}
