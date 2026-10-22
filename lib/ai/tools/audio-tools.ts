import { tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  type AttachmentCandidate,
  collectAttachmentCandidates,
  matchCandidate,
} from "@/lib/attachments/references";
import { guestRegex } from "@/lib/constants";
import { isValidUUID } from "@/lib/db/queries";
import {
  loadAudio,
  audioInfo as readDocumentAudioInfo,
  transcribeDocumentAudio,
} from "@/lib/tools/audio";
import type { ChatMessage } from "@/lib/types";

type AudioToolsProps = {
  messages?: ChatMessage[];
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Finds the audio document a name refers to.
 *
 * Audio becomes inline data for Gemini, which has no filename field — so the
 * model genuinely cannot see an attachment's name. When it names one anyway, the
 * name is matched against the conversation's attachments here.
 */
function resolveAudioId({
  messages,
  name,
}: {
  messages?: ChatMessage[];
  name?: string;
}): string | undefined {
  if (!name) {
    return;
  }

  if (isValidUUID(name)) {
    return name;
  }

  const candidates: AttachmentCandidate[] = collectAttachmentCandidates(
    messages ?? []
  );
  const match = matchCandidate(name, candidates);

  return match?.documentId;
}

/**
 * Reports an audio file's technical details.
 */
export const audioInfo = ({ messages, session }: AudioToolsProps) =>
  tool({
    description:
      "Report an audio or video file's technical details: duration, codec, bitrate, sample rate and channel count. Use it for 'how long is this', 'what format is it', 'what quality is this recording'.",
    execute: async ({ name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to inspect audio files.",
          requiresAuth: true,
        };
      }

      const documentId = resolveAudioId({ messages, name });

      if (!documentId) {
        return {
          error:
            "I could not find that audio file. Use the exact filename of the attachment.",
        };
      }

      const info = await readDocumentAudioInfo({
        documentId,
        userId: session.user.id,
      });

      if (!info) {
        return { error: "That audio file could not be opened." };
      }

      return { documentId, ...info };
    },
    inputSchema: z.object({
      name: z
        .string()
        .optional()
        .describe(
          "The filename of the attached audio file, exactly as it appears on the attachment."
        ),
    }),
  });

/**
 * Transcribes an audio file.
 */
export const audioTranscribe = ({ messages, session }: AudioToolsProps) =>
  tool({
    description:
      "Transcribe an audio or video file, with timestamps. Use it for 'transcribe this', 'what is said here', 'turn this recording into text', or to pull the words out of a lecture, meeting or interview.",
    execute: async ({ instruction, name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to transcribe audio.",
          requiresAuth: true,
        };
      }

      const documentId = resolveAudioId({ messages, name });

      if (!documentId) {
        return {
          error:
            "I could not find that audio file. Use the exact filename of the attachment.",
        };
      }

      try {
        const result = await transcribeDocumentAudio({
          documentId,
          instruction,
          userId: session.user.id,
        });

        if (!result) {
          return { error: "That audio file could not be opened." };
        }

        return {
          documentId: result.documentId,
          transcript: result.transcript,
        };
      } catch (error: any) {
        console.error("audioTranscribe failed:", error);
        return {
          error:
            error?.message ??
            "The audio could not be transcribed. Please try again.",
        };
      }
    },
    inputSchema: z.object({
      instruction: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Anything to pay particular attention to, e.g. names or figures."
        ),
      name: z
        .string()
        .optional()
        .describe("The filename of the attached audio file."),
    }),
  });

/**
 * Opens an audio file in the Audio Studio.
 */
export const audioOpen = ({ messages, session }: AudioToolsProps) =>
  tool({
    description:
      "Open an audio or video file in the Audio Studio, so the user can see its waveform, play it and read the transcript.",
    execute: async ({ name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to open audio files.",
          requiresAuth: true,
        };
      }

      const documentId = resolveAudioId({ messages, name });

      if (!documentId) {
        return {
          error:
            "I could not find that audio file. Use the exact filename of the attachment.",
        };
      }

      const audio = await loadAudio({
        documentId,
        userId: session.user.id,
      });

      if (!audio) {
        return { error: "That audio file could not be opened." };
      }

      return {
        documentId,
        duration: audio.duration,
        filename: audio.filename,
        hasTranscript: Boolean(audio.transcript),
        title: audio.title,
      };
    },
    inputSchema: z.object({
      name: z
        .string()
        .optional()
        .describe("The filename of the attached audio file."),
    }),
  });
