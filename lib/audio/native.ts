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
 * Transcribes an audio file with Gemini.
 *
 * Gemini's audio understanding is native to the model we already use, so there
 * is no transcription service, no API key and no per-minute cost.
 *
 * The timestamps come from the prompt, not from the `audioTimestamp` provider
 * option. That option looks like the obvious way to do it, but it is a Vertex AI
 * field: the Gemini Developer API rejects it outright with "Unknown name
 * 'audioTimestamp' at 'generation_config'", which fails the whole request. Asking
 * the model to write the timecodes produces the same result — and the timestamps
 * are what the studio's caption track and seek links are built from.
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
