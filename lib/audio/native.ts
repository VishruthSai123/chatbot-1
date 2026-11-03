import "server-only";

import { generateText } from "ai";
import { parseBuffer } from "music-metadata";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import type { AudioInfo } from "./waveform";

/**
 * Reading an audio file.
 *
 * `music-metadata` is a pure-JavaScript container parser: it reads the header
 * of a file without decoding the audio and without FFmpeg, so it works inside a
 * serverless function and costs nothing to run.
 */

export type AudioFileInfo = AudioInfo & {
  /** The file's size in bytes. */
  sizeBytes: number;
};

/**
 * Reads a file's audio metadata.
 *
 * A container that cannot be parsed is not a failure: the studio can still play
 * the file and the browser can still draw its waveform, so the duration is simply
 * unknown.
 */
export async function readAudioInfo(
  buffer: Buffer,
  mimeType?: string
): Promise<AudioFileInfo> {
  const fallback: AudioFileInfo = { sizeBytes: buffer.length };

  try {
    const metadata = await parseBuffer(buffer, mimeType, { duration: true });

    return {
      album: metadata.common.album ?? undefined,
      artist: metadata.common.artist ?? undefined,
      bitrate: metadata.format.bitrate ?? undefined,
      channels: metadata.format.numberOfChannels ?? undefined,
      codec: metadata.format.codec ?? undefined,
      duration: metadata.format.duration ?? undefined,
      format: metadata.format.container ?? undefined,
      sampleRate: metadata.format.sampleRate ?? undefined,
      sizeBytes: buffer.length,
      title: metadata.common.title ?? undefined,
    };
  } catch (error) {
    console.warn("Could not read audio metadata:", error);
    return fallback;
  }
}

/**
 * Transcribes an audio file.
 *
 * The model reads the audio directly, so there is no transcription service, no
 * second key and no per-minute cost.
 *
 * The timestamps come from the prompt, not from a provider option. Asking the
 * model to write the timecodes inline produces exactly what the studio needs —
 * the caption track and the seek links are both built from them.
 */
export async function transcribeAudio({
  audioUrl,
  instruction,
  mimeType,
}: {
  /** A URL the model can read. */
  audioUrl: string;
  instruction?: string;
  mimeType?: string;
}): Promise<{ transcript: string }> {
  const { text } = await generateText({
    messages: [
      {
        content: [
          {
            text: [
              "Transcribe this audio faithfully.",
              "Write [mm:ss] timestamps at the start of each sentence or passage.",
              "Keep the speaker's own words: do not summarise, do not clean up, and do not add commentary.",
              instruction ? `Pay particular attention to: ${instruction}` : "",
            ]
              .filter(Boolean)
              .join(" "),
            type: "text",
          },
          {
            data: audioUrl,
            mediaType: mimeType ?? "audio/mpeg",
            type: "file",
          },
        ],
        role: "user",
      },
    ],
    model: getGroundingModel(),
  });

  return { transcript: text.trim() };
}
