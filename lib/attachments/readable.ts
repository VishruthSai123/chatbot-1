import "server-only";

import { GEMINI_IMAGE_MEDIA_TYPES } from "@/lib/ai/vision-limits";
import { normalizeVisionImage } from "@/lib/ai/vision-normalize";
import { extractFile } from "@/lib/notebook/extract";
import type { ChatMessage } from "@/lib/types";
import { isImageType, isMediaType, mediaTypeFor } from "./media";
import { readSourceDocument } from "./source";

/*
 * Making attachments readable.
 *
 * A model can only read text and — sometimes — images. Everything else a user
 * attaches is a container: a PDF, a DOCX, a spreadsheet, a deck, a recording.
 * Sending the container and hoping is why "summarise this" used to come back
 * with an answer about nothing.
 *
 * So before the conversation reaches the model, every attachment is resolved
 * and converted:
 *
 * - text-like files are read as they are,
 * - PDFs, DOCX, XLSX and PPTX are extracted to text,
 * - images stay images when the model can see, and are OCR'd when it cannot,
 * - audio and video become a note that names the tool which can read them.
 *
 * Only the newest user message is converted. Older attachments were already
 * converted in the turn they arrived, and their content is in the assistant's
 * replies; re-extracting every file in a long chat on every turn would be slow
 * and expensive for no new information.
 */

/** How much of one file reaches the model. */
const MAX_FILE_CHARS = 20_000;

/** How much attachment text reaches the model in one request. */
const MAX_TOTAL_CHARS = 60_000;

type FilePart = {
  documentId?: string;
  filename?: string;
  mediaType?: string;
  name?: string;
  type: "file";
  url?: string;
};

function isFilePart(part: unknown): part is FilePart {
  return Boolean(part) && (part as { type?: string }).type === "file";
}

/** A heading that names the file the text came from. */
function header(filename: string): string {
  return `Attached file "${filename}":`;
}

/** Cuts text to a budget without slicing a word in half. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf("\n");

  return `${lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut}\n…(truncated)`;
}

/**
 * Converts one attachment into what the model should see.
 *
 * Returns a text part, the original file part (for an image the model can
 * see), or a note explaining which tool can read it.
 */
async function readablePart({
  part,
  userId,
  vision,
}: {
  part: FilePart;
  userId: string;
  vision: boolean;
}): Promise<{ type: "text"; text: string } | FilePart> {
  const filename = part.filename ?? part.name ?? "attachment";
  const mediaType = part.mediaType ?? mediaTypeFor(filename);

  /*
   * An image the model can see is better as an image than as OCR text. Gemini
   * accepts PNG/JPEG/WEBP/HEIC directly; anything else is re-encoded so the
   * provider never receives an unsupported inline part.
   */
  if (isImageType(mediaType) && vision) {
    if (part.documentId) {
      const imageSource = await readSourceDocument({
        documentId: part.documentId,
        userId,
      });

      if (imageSource) {
        try {
          const normalized = await normalizeVisionImage({
            buffer: imageSource.buffer,
            mediaType: imageSource.mediaType || mediaType,
          });

          return {
            ...part,
            filename,
            mediaType: normalized.mediaType,
            url: `data:${normalized.mediaType};base64,${normalized.buffer.toString("base64")}`,
          };
        } catch {
          // Fall through to text extraction: a broken image should still
          // produce a clear "could not be read" note instead of failing the
          // whole request.
        }
      }
    }

    if (GEMINI_IMAGE_MEDIA_TYPES.has(mediaType) && part.url) {
      return part;
    }
  }

  if (!part.documentId) {
    return {
      text: `${header(filename)} its content is not available in this request.`,
      type: "text",
    };
  }

  const source = await readSourceDocument({
    documentId: part.documentId,
    userId,
  });

  if (!source) {
    return {
      text: `${header(filename)} the file could not be opened.`,
      type: "text",
    };
  }

  // Audio and video are read by a tool, not by the model.
  if (isMediaType(mediaType)) {
    const tool = mediaType.startsWith("audio/")
      ? "audioTranscribe"
      : "audioTranscribe";

    return {
      text: `${header(filename)} this is a ${mediaType.startsWith("audio/") ? "recording" : "video"} and cannot be read as text. Call \`${tool}\` with name "${filename}" to read what is said.`,
      type: "text",
    };
  }

  const extraction = await extractFile({
    buffer: source.buffer,
    filename: source.filename,
    mediaType: source.mediaType,
  });

  if (extraction.error) {
    return {
      text: `${header(filename)} its text could not be extracted (${extraction.error}).`,
      type: "text",
    };
  }

  const text = extraction.sections
    .map((section) =>
      section.label ? `${section.label}\n${section.text}` : section.text
    )
    .join("\n\n")
    .trim();

  if (!text) {
    return {
      text: `${header(filename)} it contained no readable text.`,
      type: "text",
    };
  }

  return {
    text: `${header(filename)}\n\n${clip(text, MAX_FILE_CHARS)}`,
    type: "text",
  };
}

/**
 * Rewrites the newest user message so the model can read its attachments.
 *
 * The message keeps its id and role, so the UI and the database are unaffected:
 * this only changes what is sent to the provider.
 */
export async function makeAttachmentsReadable({
  messages,
  userId,
  vision,
}: {
  messages: ChatMessage[];
  userId: string;
  vision: boolean;
}): Promise<ChatMessage[]> {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user"
  );

  if (lastUserIndex === -1) {
    return messages;
  }

  const result: ChatMessage[] = [];
  let budget = MAX_TOTAL_CHARS;

  for (const [index, message] of messages.entries()) {
    if (message.role !== "user") {
      result.push(message);
      continue;
    }

    const parts: unknown[] = [];

    for (const part of message.parts) {
      if (!isFilePart(part)) {
        parts.push(part);
        continue;
      }

      // An attachment from an earlier turn was already read in that turn.
      if (index < lastUserIndex) {
        parts.push({
          text: `[Attached earlier: ${part.filename ?? part.name ?? "file"}]`,
          type: "text",
        });
        continue;
      }

      // biome-ignore lint/performance/noAwaitInLoops: attachments are read one at a time on purpose — OCR and storage reads are expensive, and the per-file budget is computed from what the previous file used
      const readable = await readablePart({ part, userId, vision });

      if (readable.type === "file") {
        parts.push(readable);
        continue;
      }

      if (budget <= 0) {
        parts.push({
          text: `${header(part.filename ?? part.name ?? "attachment")} (omitted: this request already carries as much attachment text as it can.)`,
          type: "text",
        });
        continue;
      }

      const text = clip(readable.text, Math.min(MAX_FILE_CHARS, budget));

      budget -= text.length;
      parts.push({ text, type: "text" });
    }

    result.push({ ...message, parts } as ChatMessage);
  }

  return result;
}
