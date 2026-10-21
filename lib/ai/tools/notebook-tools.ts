import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { guestRegex } from "@/lib/constants";
import { getLatestDocumentByKind } from "@/lib/db/queries";
import type {
  NotebookDeliverableKind,
  NotebookSource,
} from "@/lib/notebook/ref";
import {
  addNotebookSource,
  askNotebook,
  createNotebook,
  generateDeliverable,
  generateQuiz,
  gradeQuizAnswer,
} from "@/lib/tools/notebook";
import type { ChatMessage } from "@/lib/types";

type NotebookToolsProps = {
  chatId?: string;
  /** Only the tools that reveal a panel need to write to the stream. */
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  /** The conversation so far, including the message being answered. */
  messages?: ChatMessage[];
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Turns the names the model gave into sources it can actually open.
 *
 * The model sees filenames, not document ids — the same constraint the image
 * tools work under — so a file source is matched against the attachments in the
 * conversation and a URL source is taken as it is.
 */
function buildSources({ files, urls }: { files?: string[]; urls?: string[] }): {
  sources: NotebookSource[];
  unknown: string[];
} {
  const sources: NotebookSource[] = [];
  const unknown: string[] = [];
  const addedAt = new Date().toISOString();

  for (const url of urls ?? []) {
    if (!/^https?:\/\//i.test(url)) {
      unknown.push(url);
      continue;
    }

    sources.push({ addedAt, kind: "url", title: url, url });
  }

  for (const file of files ?? []) {
    // A URL slipped into the files list is still a URL.
    if (/^https?:\/\//i.test(file)) {
      sources.push({ addedAt, kind: "url", title: file, url: file });
      continue;
    }

    sources.push({ addedAt, kind: "file", title: file });
  }

  return { sources, unknown };
}

/**
 * Finds the id of a file the model named, among the conversation's attachments.
 *
 * The conversation is passed in rather than read from the database: the route
 * already has it, including the message currently being answered, and reading it
 * again would be both slower and racy — the write of that message may still be
 * in flight.
 */
async function resolveFileSourceIds({
  files,
  messages,
}: {
  files?: string[];
  messages?: ChatMessage[];
}): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  if (!files?.length) {
    return resolved;
  }

  const { collectAttachmentCandidates, matchCandidate } = await import(
    "@/lib/attachments/references"
  );

  const candidates = collectAttachmentCandidates(messages ?? []);

  for (const file of files) {
    if (/^https?:\/\//i.test(file)) {
      continue;
    }

    const match = matchCandidate(file, candidates);

    if (match?.documentId) {
      resolved.set(file, match.documentId);
    }
  }

  return resolved;
}

/**
 * Creates a notebook.
 *
 * A notebook is a set of sources, so this is the entry point to the whole
 * NotebookLM-style layer: everything else asks questions of a notebook this
 * created.
 */
export const notebookCreate = ({
  chatId: _chatId,
  dataStream,
  messages,
  session,
}: NotebookToolsProps) =>
  tool({
    description:
      "Create a notebook from a set of sources — files the user attached and/or web page URLs. Use it when the user wants a collection of sources they can ask questions of, a study set, a research folder, or a summary of several documents. The notebook can then be questioned, summarised, turned into a study guide or FAQ, or quizzed.",
    execute: async ({ files, title, urls }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to build notebooks.",
          requiresAuth: true,
        };
      }

      const { sources, unknown } = buildSources({ files, urls });

      if (sources.length === 0) {
        return {
          error:
            "A notebook needs at least one source. Name the attached files, or give a URL.",
        };
      }

      const fileIds = await resolveFileSourceIds({
        files: sources
          .filter((source) => source.kind === "file")
          .map((source) => source.title),
        messages,
      });

      const resolved: NotebookSource[] = [];

      for (const source of sources) {
        if (source.kind === "url") {
          resolved.push(source);
          continue;
        }

        const documentId = fileIds.get(source.title);

        if (documentId) {
          resolved.push({ ...source, documentId });
        }
      }

      if (resolved.length === 0) {
        return {
          error:
            "None of those sources could be matched to an attachment. Use the exact filename the user attached, or give a URL.",
          unmatched: unknown,
        };
      }

      const created = await createNotebook({
        sources: resolved,
        title: title || "Notebook",
        userId: session.user.id,
      });

      dataStream?.write({
        data: "notebook",
        transient: true,
        type: "data-kind",
      });
      dataStream?.write({
        data: created.documentId,
        transient: true,
        type: "data-id",
      });
      dataStream?.write({
        data: title || "Notebook",
        transient: true,
        type: "data-title",
      });
      dataStream?.write({
        data: created.content,
        transient: true,
        type: "data-notebookDelta",
      });
      dataStream?.write({ data: null, transient: true, type: "data-finish" });

      return {
        documentId: created.documentId,
        sources: resolved.map((source) => source.title),
        title: title || "Notebook",
        unmatched: unknown,
      };
    },
    inputSchema: z.object({
      files: z
        .array(z.string())
        .optional()
        .describe(
          "Filenames of the attached files to include, exactly as they appear on the attachment."
        ),
      title: z
        .string()
        .max(120)
        .optional()
        .describe("A short name for the notebook."),
      urls: z
        .array(z.string())
        .optional()
        .describe("Web pages to include as sources."),
    }),
  });

/**
 * Asks a question of a notebook.
 *
 * The answer is grounded in the notebook's sources and comes back with the
 * passages it used, so the citations are the ones the model actually read.
 */
export const notebookAsk = ({ session }: NotebookToolsProps) =>
  tool({
    description:
      "Ask a question about the sources in a notebook and get a grounded, cited answer. Use it for anything that depends on what the sources say — comparisons between documents, a specific figure, what one document says about another. The answer says so when the sources do not cover the question.",
    execute: async ({ documentId, question }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to use notebooks.",
          requiresAuth: true,
        };
      }

      const id = documentId ?? (await latestNotebookId(session));

      if (!id) {
        return { error: "There is no notebook in this chat yet." };
      }

      const answer = await askNotebook({
        documentId: id,
        question,
        userId: session.user.id,
      });

      if (!answer) {
        return { error: "That notebook could not be opened." };
      }

      return {
        answer: answer.answer,
        citations: answer.citations,
        mode: answer.mode,
        question,
      };
    },
    inputSchema: z.object({
      documentId: z
        .string()
        .optional()
        .describe(
          "The notebook's document id. Omit to use the notebook open in the studio."
        ),
      question: z.string().min(3).max(2000).describe("The question to answer."),
    }),
  });

/**
 * Generates a deliverable from a notebook.
 */
export const notebookGenerate = ({ session }: NotebookToolsProps) =>
  tool({
    description:
      "Generate something from a notebook's sources: a summary, a study guide, an FAQ, a timeline or a briefing. Use it when the user wants the material turned into a document rather than an answer to a question.",
    execute: async ({ documentId, kind }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to use notebooks.",
          requiresAuth: true,
        };
      }

      const id = documentId ?? (await latestNotebookId(session));

      if (!id) {
        return { error: "There is no notebook in this chat yet." };
      }

      const deliverable = await generateDeliverable({
        documentId: id,
        kind: kind as NotebookDeliverableKind,
        userId: session.user.id,
      });

      if (!deliverable) {
        return {
          error:
            "That notebook has no readable sources, so nothing could be generated.",
        };
      }

      return {
        citations: deliverable.citations,
        content: deliverable.content,
        kind,
        title: deliverable.title,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      kind: z
        .enum(["summary", "study_guide", "faq", "timeline", "briefing"])
        .optional()
        .default("summary")
        .describe(
          "What to generate. 'summary' is the key points, 'study_guide' teaches the material, 'faq' is questions and answers, 'timeline' is the events in order, 'briefing' is what matters."
        ),
    }),
  });

/**
 * Starts a quiz.
 *
 * The answer key is never sent to the client: grading marks the user's answer
 * against the source passage, so a free-text answer can be judged as well as a
 * multiple-choice one.
 */
export const notebookQuiz = ({ session }: NotebookToolsProps) =>
  tool({
    description:
      "Start a quiz from a notebook's sources. Returns questions with four options each. Then ask the user one question at a time and mark their answer with notebookGrade.",
    execute: async ({ documentId }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to use notebooks.",
          requiresAuth: true,
        };
      }

      const id = documentId ?? (await latestNotebookId(session));

      if (!id) {
        return { error: "There is no notebook in this chat yet." };
      }

      const quiz = await generateQuiz({
        documentId: id,
        userId: session.user.id,
      });

      if (!quiz) {
        return {
          error:
            "That notebook has no readable sources, so no quiz could be written.",
        };
      }

      return { documentId: id, questions: quiz.questions };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
    }),
  });

/**
 * Marks a quiz answer.
 */
export const notebookGrade = ({ session }: NotebookToolsProps) =>
  tool({
    description:
      "Mark the user's answer to a quiz question, judged against the source it came from. Returns correct, partial or incorrect, with feedback and the source passage that settles it.",
    execute: async ({ answer, documentId, questionId }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to use notebooks.",
          requiresAuth: true,
        };
      }

      const id = documentId ?? (await latestNotebookId(session));

      if (!id) {
        return { error: "There is no notebook in this chat yet." };
      }

      const grade = await gradeQuizAnswer({
        answer,
        documentId: id,
        questionId,
        userId: session.user.id,
      });

      if (!grade) {
        return {
          error:
            "That question is not part of the current quiz. Run notebookQuiz first.",
        };
      }

      return { ...grade, questionId };
    },
    inputSchema: z.object({
      answer: z.string().min(1).max(4000).describe("The user's answer."),
      documentId: z.string().optional(),
      questionId: z
        .string()
        .describe("The id of the question being answered, e.g. 'q1'."),
    }),
  });

/**
 * Adds a source to an existing notebook.
 */
export const notebookAddSource = ({ messages, session }: NotebookToolsProps) =>
  tool({
    description:
      "Add a source to an existing notebook — an attached file or a web page. Use it when the user mentions a new document while a notebook is already open.",
    execute: async ({ documentId, file, url }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to use notebooks.",
          requiresAuth: true,
        };
      }

      const id = documentId ?? (await latestNotebookId(session));

      if (!id) {
        return { error: "There is no notebook in this chat yet." };
      }

      const { sources, unknown } = buildSources({
        files: file ? [file] : undefined,
        urls: url ? [url] : undefined,
      });

      if (sources.length === 0) {
        return { error: "Give a filename or a URL to add." };
      }

      const fileIds = await resolveFileSourceIds({
        files: file ? [file] : undefined,
        messages,
      });

      const [source] = sources;
      const documentIdForSource = fileIds.get(source.title);

      const result = await addNotebookSource({
        documentId: id,
        source: {
          ...source,
          ...(documentIdForSource ? { documentId: documentIdForSource } : {}),
        },
        userId: session.user.id,
      });

      if (!result) {
        return { error: "That notebook could not be opened." };
      }

      return {
        documentId: id,
        matched: Boolean(documentIdForSource) || source.kind === "url",
        sources: result.notebook.ref.sources.map((entry) => entry.title),
        unmatched: unknown,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      file: z
        .string()
        .optional()
        .describe("The filename of an attached file to add."),
      url: z.string().optional().describe("A web page to add as a source."),
    }),
  });

/**
 * The notebook the user is most likely to mean.
 */
async function latestNotebookId(session: Session): Promise<string | undefined> {
  const latest = await getLatestDocumentByKind({
    kind: "notebook",
    userId: session.user.id,
  });

  return latest?.id;
}
