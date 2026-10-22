import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import type { AttachmentCandidate } from "@/lib/attachments/references";
import {
  collectAttachmentCandidates,
  matchCandidate,
} from "@/lib/attachments/references";
import { guestRegex } from "@/lib/constants";
import { isValidUUID } from "@/lib/db/queries";
import {
  convertDocument,
  diffDocuments,
  readDocument,
  summarizeDocument,
} from "@/lib/tools/doc";
import type { ChatMessage } from "@/lib/types";

type DocToolsProps = {
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  messages?: ChatMessage[];
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Finds the document a name refers to.
 *
 * The model sees filenames, not document ids — the AI SDK drops the id when it
 * converts a message for the provider. So a name is matched against the
 * attachments in the conversation, the same way the image tools do it.
 */
function resolveDocumentId({
  candidates,
  name,
}: {
  candidates: AttachmentCandidate[];
  name?: string;
}): string | undefined {
  if (!name) {
    return;
  }

  if (isValidUUID(name)) {
    return name;
  }

  return matchCandidate(name, candidates)?.documentId;
}

/**
 * Reads a document's text, structure and statistics.
 */
export const docRead = ({ messages, session }: DocToolsProps) =>
  tool({
    description:
      "Read an attached document: its full text, its heading structure and its reading statistics. Use it for anything that depends on what a .docx, .md or .txt file says — quoting it, checking a figure, or finding which section covers something.",
    execute: async ({ documentId, name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to read documents.",
          requiresAuth: true,
        };
      }

      const candidates = collectAttachmentCandidates(messages ?? []);
      const id = resolveDocumentId({ candidates, name: name ?? documentId });

      if (!id) {
        return {
          error:
            "I could not find that document. Use the exact filename of the attachment.",
        };
      }

      try {
        const document = await readDocument({
          documentId: id,
          userId: session.user.id,
        });

        return {
          documentId: id,
          outline: document.outline,
          readingMinutes: document.minutesToRead,
          text: document.text,
          words: document.words,
        };
      } catch (error: any) {
        return { error: error?.message ?? "That document could not be read." };
      }
    },
    inputSchema: z.object({
      documentId: z
        .string()
        .optional()
        .describe("The document's id. Prefer `name`."),
      name: z
        .string()
        .optional()
        .describe(
          "The filename of the attached document, exactly as it appears on the attachment."
        ),
    }),
  });

/**
 * Summarises a document.
 */
export const docSummarize = ({ messages, session }: DocToolsProps) =>
  tool({
    description:
      "Summarise an attached document. Use it for 'summarise this', 'what is this document about', 'give me the key points', or a summary of a specific part ('summarise the risks section').",
    execute: async ({ documentId, instruction, name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to summarise documents.",
          requiresAuth: true,
        };
      }

      const candidates = collectAttachmentCandidates(messages ?? []);
      const id = resolveDocumentId({ candidates, name: name ?? documentId });

      if (!id) {
        return {
          error:
            "I could not find that document. Use the exact filename of the attachment.",
        };
      }

      try {
        const { summary } = await summarizeDocument({
          documentId: id,
          instruction,
          userId: session.user.id,
        });

        return { documentId: id, summary };
      } catch (error: any) {
        return { error: error?.message ?? "That document could not be read." };
      }
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      instruction: z
        .string()
        .max(500)
        .optional()
        .describe("What to focus the summary on, e.g. 'the risks section'."),
      name: z
        .string()
        .optional()
        .describe("The filename of the attached document."),
    }),
  });

/**
 * Compares two documents.
 */
export const docDiff = ({ messages, session }: DocToolsProps) =>
  tool({
    description:
      "Compare two documents and show what changed between them, line by line. Use it for 'what changed between these two versions', 'diff these', or 'which paragraphs differ'.",
    execute: async ({ documentA, documentB }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to compare documents.",
          requiresAuth: true,
        };
      }

      const candidates = collectAttachmentCandidates(messages ?? []);
      const idA = resolveDocumentId({ candidates, name: documentA });
      const idB = resolveDocumentId({ candidates, name: documentB });

      if (!(idA && idB)) {
        return {
          error:
            "I need both documents. Name them by their filenames, e.g. 'v1.docx' and 'v2.docx'.",
        };
      }

      try {
        const diff = await diffDocuments({
          documentIdA: idA,
          documentIdB: idB,
          userId: session.user.id,
        });

        return {
          added: diff.added,
          documentA: idA,
          documentB: idB,
          removed: diff.removed,
          segments: diff.segments,
          unchanged: diff.unchanged,
        };
      } catch (error: any) {
        return {
          error: error?.message ?? "Those documents could not be compared.",
        };
      }
    },
    inputSchema: z.object({
      documentA: z.string().describe("The filename of the first document."),
      documentB: z.string().describe("The filename of the second document."),
    }),
  });

/**
 * Reports a document's structure and reading statistics.
 */
export const docStats = ({ messages, session }: DocToolsProps) =>
  tool({
    description:
      "Report a document's structure and reading statistics: its headings, word count, paragraph count and how long it takes to read or present. Use it for 'how long is this', 'what sections does it have', 'how many words'.",
    execute: async ({ documentId, name }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to inspect documents.",
          requiresAuth: true,
        };
      }

      const candidates = collectAttachmentCandidates(messages ?? []);
      const id = resolveDocumentId({ candidates, name: name ?? documentId });

      if (!id) {
        return {
          error:
            "I could not find that document. Use the exact filename of the attachment.",
        };
      }

      try {
        const document = await readDocument({
          documentId: id,
          userId: session.user.id,
        });

        return {
          characters: document.characters,
          documentId: id,
          minutesToRead: document.minutesToRead,
          outline: document.outline,
          paragraphs: document.paragraphs,
          sentences: document.sentences,
          words: document.words,
        };
      } catch (error: any) {
        return { error: error?.message ?? "That document could not be read." };
      }
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      name: z.string().optional().describe("The filename of the document."),
    }),
  });

/**
 * Converts a document to Markdown or plain text.
 */
export const docConvert = ({ messages, session }: DocToolsProps) =>
  tool({
    description:
      "Convert an attached document to Markdown or plain text. Use it when the user wants a .docx as Markdown, or the text of a document in a form they can copy.",
    execute: async ({ documentId, name, targetFormat }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to convert documents.",
          requiresAuth: true,
        };
      }

      const candidates = collectAttachmentCandidates(messages ?? []);
      const id = resolveDocumentId({ candidates, name: name ?? documentId });

      if (!id) {
        return {
          error:
            "I could not find that document. Use the exact filename of the attachment.",
        };
      }

      try {
        const converted = await convertDocument({
          documentId: id,
          targetFormat,
          userId: session.user.id,
        });

        return {
          content: converted.content,
          documentId: id,
          format: converted.format,
        };
      } catch (error: any) {
        return {
          error: error?.message ?? "That document could not be converted.",
        };
      }
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      name: z.string().optional().describe("The filename of the document."),
      targetFormat: z
        .enum(["md", "txt"])
        .optional()
        .default("md")
        .describe("'md' for Markdown, 'txt' for plain text."),
    }),
  });
