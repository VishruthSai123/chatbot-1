# Family 05: Audio & Media Studio Rulebook

## 1. Family Scope & Core Philosophy
The Audio & Media Studio family provides local container metadata inspection, client-side waveform playback, and AI-driven speech transcription without incurring third-party transcription SaaS fees (such as Whisper API or AssemblyAI).

### Native Stack
- **Server Metadata Engine**: `music-metadata` (native pure-JavaScript audio/video container parser; extracts duration, codec, bitrate, channels, and sample rate without FFmpeg binary dependencies).
- **Client Media Player**: HTML5 Audio / Web Audio API with synchronized waveform and timestamp seek.
- **Multimodal AI Transcription**: Google Gemini 2.5 Flash (utilizing native audio understanding capability already configured via `@ai-sdk/google`).
- **Storage**: Supabase Storage (`artifacts` private bucket).

---

## 2. Active Tools Specification

### 2.1 `media_get_metadata` (Audio & Media Telemetry)
Extracts container information, technical codecs, duration, bitrate, and sample rate locally in Node.js.

#### Native Implementation:
```typescript
import * as mm from "music-metadata";

export interface MediaMetadata {
  durationSeconds: number;
  format: string;
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  codec?: string;
  artist?: string;
  title?: string;
}

export async function getMediaMetadata({
  mediaBuffer,
  mimeType,
}: {
  mediaBuffer: Buffer;
  mimeType: string;
}): Promise<MediaMetadata> {
  const metadata = await mm.parseBuffer(mediaBuffer, { mimeType }, { duration: true });

  return {
    durationSeconds: Math.round(metadata.format.duration || 0),
    format: metadata.format.container || mimeType,
    bitrate: metadata.format.bitrate,
    sampleRate: metadata.format.sampleRate,
    numberOfChannels: metadata.format.numberOfChannels,
    codec: metadata.format.codec,
    artist: metadata.common.artist,
    title: metadata.common.title,
  };
}
```

---

### 2.2 `media_transcribe` (Speech-to-Text with Timestamps)
Transcribes uploaded audio files (MP3, WAV, M4A, OGG) using Gemini 2.5 Flash multimodal audio input.

#### Native Implementation:
```typescript
import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai/providers";

export interface TranscriptSegment {
  timestamp: string;
  speaker?: string;
  text: string;
}

export async function transcribeAudio({
  audioBuffer,
  mimeType,
  language,
}: {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
}): Promise<{ transcript: string; segments: TranscriptSegment[] }> {
  const base64Audio = audioBuffer.toString("base64");

  const prompt = `Transcribe the attached audio accurately. ${language ? `Language is ${language}.` : ""}
Provide a timestamped breakdown in the following JSON format:
{
  "fullTranscript": "complete text here",
  "segments": [
    { "timestamp": "00:00 - 00:05", "speaker": "Speaker 1", "text": "Hello world" }
  ]
}
Return only valid JSON.`;

  const { text } = await generateText({
    model: getLanguageModel("gemini-2.5-flash"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "file", data: base64Audio, mimeType },
        ],
      },
    ],
  });

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      transcript: parsed.fullTranscript,
      segments: parsed.segments || [],
    };
  } catch (err) {
    return {
      transcript: text,
      segments: [{ timestamp: "00:00", text }],
    };
  }
}
```

---

## 3. Dynamic Right Pane: Media Studio Canvas

When viewing an audio or video artifact, the Right Pane dynamically renders the Media Studio:

```
+---------------------------------------------------------------------------------------------------+
| Dynamic Media Studio Canvas                                                                       |
+---------------------------------------------------------------------------------------------------+
| [▶ Play] [⏸ Pause] [01:24 / 04:30] [Speed: 1x ▼] [Download Audio] [Export SRT / VTT Subtitles]     |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    Waveform Scrubber:                                                                             |
|     ▂▃▅▆▇█▇▆▅▃▂ ▂▃▅▆▇█▇▆▅▃ ▂▃▅▆▇█▇▆▅▃▂ [● Scrubber Marker] ▂▃▅▆▇█▇▆▅▃                              |
|                                                                                                   |
|    Synchronized Timestamped Transcript:                                                           |
|    ┌────────────────────────────────────────────────────────────────────────┐                     |
|    │ [00:00 - 00:15] Speaker 1:                                             │                     |
|    │ Welcome everyone to today's product strategy review.                   │                     |
|    │                                                                        │                     |
|    │ [00:16 - 00:45] Speaker 2:                                             │                     |
|    │ Today we are demonstrating native-first execution for file tools.      │                     |
|    │                                                                        │                     |
|    │ [00:46 - 01:20] Speaker 1:                                             │                     |
|    │ Zero third-party conversion bills and instant responsive performance. │                     |
|    └────────────────────────────────────────────────────────────────────────┘                     |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
| Media: meeting_recording.mp3 | 44.1 kHz | 128 kbps Stereo | Duration: 4m 30s                      |
+---------------------------------------------------------------------------------------------------+
```

### Key UI Features:
1. **Interactive Waveform Player**: Visual playback bar with scrubber and speed controls (0.75x, 1x, 1.25x, 1.5x, 2x).
2. **Click-to-Seek Timestamps**: Clicking any timestamp segment immediately jumps the audio player to that exact playback position.
3. **Subtitle Export**: 1-click generation of `.srt` and `.vtt` caption files.
