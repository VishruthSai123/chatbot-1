import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import {
  getDocumentById,
  getDocumentsById,
  isValidUUID,
  saveDocument,
} from "@/lib/db/queries";
import type { NotebookChunk } from "@/lib/notebook/chunk";
import {
  type ExtractionResult,
  extractFile,
  extractUrl,
  sectionsToChunks,
} from "@/lib/notebook/extract";
import {
  decodeNotebookRef,
  encodeNotebookRef,
  type NotebookDeliverableKind,
  type NotebookQuizQuestion,
  type NotebookRef,
  type NotebookSource,
} from "@/lib/notebook/ref";
import {
  getCachedChunks,
  setCachedChunks,
  sourceCacheKey,
} from "@/lib/notebook/registry";
import { planRetrieval } from "@/lib/notebook/retrieval";
import { downloadArtifact } from "@/lib/storage";

/**
 * Reading and writing notebooks.
 *
 * The shape of a notebook is deliberately boring: a document whose content lists
 * sources, and a set of operations over it. Everything else — retrieval,
 * deliverables, the quiz — is a *view* of those sources, computed on demand.
 *
 * That matters because it means a notebook never goes stale: the sources stay
 * the single source of truth, and the derived material is regenerated when it is
 * asked for.
 */

export type NotebookContext = {
  chatId?: string;
  userId: string;
};

/** A source that has been read, with its text. */
export type ResolvedSource = {
  chunks: NotebookChunk[];
  error?: string;
  source: NotebookSource;
  text: string;
};

export type LoadedNotebook = {
  documentId: string;
  ref: NotebookRef;
  sources: ResolvedSource[];
  chunks: NotebookChunk[];
  title: string;
};

/** How a source's text is found for a question. */
export type NotebookAnswer = {
  answer: string;
  /** The passages the answer was written from. */
  citations: { index: number; label?: string; title: string }[];
  /** "full" when the whole notebook fit in the context. */
  mode: "full" | "searched";
};

/**
 * Reads the bytes of an uploaded file that backs a source.
 */
async function loadSourceFile(
  source: NotebookSource,
  userId: string
): Promise<{ buffer: Buffer; filename?: string; mediaType?: string } | null> {
  if (!source.documentId || !isValidUUID(source.documentId)) {
    return null;
  }

  const document = await getDocumentById({ id: source.documentId });

  if (!document || document.userId !== userId) {
    return null;
  }

  // The content is a storage reference; the bytes are in the bucket.
  const { decodeImageRef } = await import("@/lib/image/ref");
  const { decodePdfRef } = await import("@/lib/pdf/ref");
  const { decodeSheetRef } = await import("@/lib/sheet/ref");

  const image = decodeImageRef(document.content);
  const pdf = decodePdfRef(document.content);
  const sheet = decodeSheetRef(document.content);
  const storageKey = image?.storageKey ?? pdf?.storageKey ?? sheet?.storageKey;

  if (!storageKey) {
    return null;
  }

  return {
    buffer: await downloadArtifact(storageKey),
    filename: image?.filename ?? pdf?.filename ?? sheet?.filename ?? undefined,
    mediaType: image?.format ? `image/${image.format}` : undefined,
  };
}

/**
 * Reads one source into text.
 *
 * A source that cannot be read is reported, not fatal: a notebook with one
 * broken link should still answer from the other four.
 */
async function resolveSource(
  source: NotebookSource,
  userId: string
): Promise<ResolvedSource> {
  const key = sourceCacheKey(source);
  const cached = getCachedChunks(key);

  if (cached) {
    return {
      chunks: cached,
      source,
      text: cached.map((chunk) => chunk.text).join("\n\n"),
    };
  }

  if (source.kind === "url" && source.url) {
    const extraction: ExtractionResult = await extractUrl(source.url);

    if (extraction.error) {
      return { chunks: [], error: extraction.error, source, text: "" };
    }

    const chunks = sectionsToChunks(extraction.sections);
    setCachedChunks(key, chunks);

    return {
      chunks,
      source,
      text: extraction.sections.map((section) => section.text).join("\n\n"),
    };
  }

  const file = await loadSourceFile(source, userId);

  if (!file) {
    return {
      chunks: [],
      error: "That file is no longer available.",
      source,
      text: "",
    };
  }

  const extraction = await extractFile({
    buffer: file.buffer,
    filename: file.filename ?? source.title,
    mediaType: file.mediaType ?? source.mediaType,
  });

  if (extraction.error) {
    return { chunks: [], error: extraction.error, source, text: "" };
  }

  const chunks = sectionsToChunks(extraction.sections);
  setCachedChunks(key, chunks);

  return {
    chunks,
    source,
    text: extraction.sections.map((section) => section.text).join("\n\n"),
  };
}

/**
 * Loads a notebook: its reference, and the text of every source it can read.
 */
export async function loadNotebook({
  documentId,
  userId,
  versionIndex,
}: {
  documentId: string;
  userId: string;
  versionIndex?: number;
}): Promise<LoadedNotebook | null> {
  if (!isValidUUID(documentId)) {
    return null;
  }

  let content: string | null = null;
  let title = "Notebook";

  if (typeof versionIndex === "number" && versionIndex >= 0) {
    const versions = await getDocumentsById({ id: documentId });
    const requested = versions[versionIndex];

    if (requested?.userId === userId) {
      ({ content, title } = requested);
    }
  }

  if (content === null) {
    const document = await getDocumentById({ id: documentId });

    if (!document || document.userId !== userId) {
      return null;
    }

    ({ content, title } = document);
  }

  const ref = decodeNotebookRef(content);

  if (!ref) {
    return null;
  }

  const sources: ResolvedSource[] = [];

  for (const source of ref.sources) {
    // biome-ignore lint/performance/noAwaitInLoops: one source at a time keeps peak memory flat; a notebook of full-resolution PDFs would otherwise be decoded all at once
    sources.push(await resolveSource(source, userId));
  }

  const chunks = sources.flatMap((entry) => entry.chunks);

  return {
    chunks,
    documentId,
    ref,
    sources,
    title: ref.title ?? title,
  };
}

/** Writes a notebook's reference back as a new version. */
async function saveNotebook({
  documentId,
  ref,
  title,
  userId,
}: {
  documentId: string;
  ref: NotebookRef;
  title: string;
  userId: string;
}): Promise<boolean> {
  try {
    await saveDocument({
      content: encodeNotebookRef(ref),
      id: documentId,
      kind: "notebook",
      title,
      userId,
    });

    return true;
  } catch (error) {
    console.warn("Non-fatal: failed to persist notebook:", error);
    return false;
  }
}

/** Creates a notebook from a set of sources. */
export async function createNotebook({
  chatId: _chatId,
  sources,
  title,
  userId,
}: {
  chatId?: string;
  sources: NotebookSource[];
  title: string;
  userId: string;
}): Promise<{ content: string; documentId: string }> {
  const documentId = crypto.randomUUID();
  const ref: NotebookRef = { sources, title };
  const content = encodeNotebookRef(ref);

  await saveDocument({
    content,
    id: documentId,
    kind: "notebook",
    title,
    userId,
  });

  return { content, documentId };
}

/** Adds a source to an existing notebook and saves a new version. */
export async function addNotebookSource({
  documentId,
  source,
  userId,
}: {
  documentId: string;
  source: NotebookSource;
  userId: string;
}): Promise<{ notebook: LoadedNotebook } | null> {
  const notebook = await loadNotebook({ documentId, userId });

  if (!notebook) {
    return null;
  }

  const already = notebook.ref.sources.some(
    (existing) =>
      existing.documentId === source.documentId ||
      (source.url && existing.url === source.url)
  );

  if (!already) {
    const ref: NotebookRef = {
      ...notebook.ref,
      sources: [...notebook.ref.sources, source],
    };

    await saveNotebook({
      documentId,
      ref,
      title: notebook.title,
      userId,
    });
  }

  return { notebook };
}

/**
 * Formats the passages for the model, with a numbered source list.
 *
 * The numbering is what the model cites, so the labels have to be unambiguous:
 * "[3] (Page 12 of report.pdf)" says both which passage and where it came from.
 */
function formatPassages(passages: NotebookChunk[]): {
  citations: { index: number; label?: string; title: string }[];
  text: string;
} {
  const citations: { index: number; label?: string; title: string }[] = [];
  const parts: string[] = [];

  passages.forEach((chunk, position) => {
    const index = position + 1;
    const title = chunk.label ?? "Source";

    citations.push({ index, label: chunk.label, title });
    parts.push(`[${index}] (${title})\n${chunk.text}\n`);
  });

  return { citations, text: parts.join("\n") };
}

/**
 * Answers a question from a notebook.
 *
 * The model is told to use *only* the passages it is given and to say so when
 * they do not answer the question. A grounded answer that admits its limits is
 * worth far more than a confident one that invented a fact.
 */
export async function askNotebook({
  documentId,
  question,
  userId,
  versionIndex,
}: {
  documentId: string;
  question: string;
  userId: string;
  versionIndex?: number;
}): Promise<NotebookAnswer | null> {
  const notebook = await loadNotebook({ documentId, userId, versionIndex });

  if (!notebook) {
    return null;
  }

  if (notebook.chunks.length === 0) {
    return {
      answer:
        "This notebook has no readable sources yet, so there is nothing to answer from.",
      citations: [],
      mode: "full",
    };
  }

  const plan = planRetrieval({
    chunks: notebook.chunks,
    query: question,
  });

  const { citations, text } = formatPassages(plan.passages);

  const { text: answer } = await generateText({
    model: getGroundingModel(),
    prompt: [
      "Answer the question using ONLY the numbered sources below.",
      "Cite every claim with its number, like [2].",
      "If the sources do not answer the question, say exactly that — do not fill the gap from general knowledge.",
      "Quote figures and names exactly as the sources state them.",
      "",
      `QUESTION: ${question}`,
      "",
      "SOURCES:",
      text,
    ].join("\n"),
  });

  return { answer, citations, mode: plan.kind };
}

/** The instruction for each kind of deliverable. */
const DELIVERABLE_PROMPTS: Record<NotebookDeliverableKind, string> = {
  briefing:
    "Write a briefing: what the sources say, what matters, and what a reader should know. Lead with the conclusion.",
  faq: "Write a FAQ: the questions a reader would actually ask, each with a direct answer grounded in the sources.",
  study_guide:
    "Write a study guide: the key concepts, the definitions, the relationships between ideas, and what a learner must be able to explain.",
  summary:
    "Write a summary: the central point, then the supporting detail, in order of importance.",
  timeline:
    "Write a timeline of the events the sources describe, in order, with the date or period for each.",
};

/**
 * Generates a deliverable from a notebook.
 */
export async function generateDeliverable({
  documentId,
  kind,
  title,
  userId,
  versionIndex,
}: {
  documentId: string;
  kind: NotebookDeliverableKind;
  title?: string;
  userId: string;
  versionIndex?: number;
}): Promise<{
  content: string;
  citations: { index: number; label?: string; title: string }[];
  title: string;
} | null> {
  const notebook = await loadNotebook({ documentId, userId, versionIndex });

  if (!notebook || notebook.chunks.length === 0) {
    return null;
  }

  const plan = planRetrieval({ chunks: notebook.chunks });
  const { citations, text } = formatPassages(plan.passages);

  const { text: content } = await generateText({
    model: getGroundingModel(),
    prompt: [
      DELIVERABLE_PROMPTS[kind],
      "Use only the numbered sources. Cite with [n] markers.",
      "Do not add facts that are not in the sources.",
      "Use Markdown headings and lists.",
      "",
      "SOURCES:",
      text,
    ].join("\n"),
  });

  const deliverableTitle =
    title ?? `${notebook.title} — ${kind.replace("_", " ")}`;

  await saveNotebook({
    documentId,
    ref: {
      ...notebook.ref,
      deliverable: {
        content,
        createdAt: new Date().toISOString(),
        kind,
        title: deliverableTitle,
      },
    },
    title: notebook.title,
    userId,
  });

  return { citations, content, title: deliverableTitle };
}

/** How many questions a quiz should have. */
const QUIZ_LENGTH = 5;

/** Shuffles a list without bias towards the original order. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }

  return result;
}

/**
 * Generates a quiz from a notebook.
 *
 * The questions are written against the sources and each carries the source it
 * came from, so a wrong answer can be explained with the passage that settles it.
 *
 * The answer key is deliberately *not* stored. Grading asks the model to judge
 * the answer against the source passage, which means a free-text answer can be
 * marked as well as a multiple-choice one — and nothing on the client can
 * reveal the answers before the user has tried them.
 */
export async function generateQuiz({
  documentId,
  userId,
  versionIndex,
}: {
  documentId: string;
  userId: string;
  versionIndex?: number;
}): Promise<{ questions: NotebookQuizQuestion[] } | null> {
  const notebook = await loadNotebook({ documentId, userId, versionIndex });

  if (!notebook || notebook.chunks.length === 0) {
    return null;
  }

  const plan = planRetrieval({ chunks: notebook.chunks });
  const { text } = formatPassages(plan.passages);

  const { output } = await generateText({
    model: getGroundingModel(),
    output: Output.object({
      schema: z.object({
        questions: z.array(
          z.object({
            correctIndex: z.number().int().min(0).max(3),
            options: z.array(z.string().min(1)).length(4),
            question: z.string().min(5),
            sourceTitle: z.string().optional(),
          })
        ),
      }),
    }),
    prompt: [
      `Write ${QUIZ_LENGTH} quiz questions about the sources below.`,
      "Each question must be answerable from the sources alone.",
      "Give each question exactly four options, with the correct one FIRST, and record its position in correctIndex.",
      "Say which source each question came from in its sourceTitle field.",
      "",
      "SOURCES:",
      text,
    ].join("\n"),
  });

  // The options are shuffled here rather than by the model: a model asked to
  // shuffle produces the same order every time, and "the answer is always the
  // first option" is a quiz nobody can take seriously.
  const questions: NotebookQuizQuestion[] = output.questions.map(
    (question, index) => {
      const correct =
        question.options[question.correctIndex] ?? question.options[0];
      const others = question.options.filter(
        (_, optionIndex) => optionIndex !== question.correctIndex
      );
      const shuffled = shuffle(others);
      const correctPosition = Math.floor(Math.random() * (shuffled.length + 1));
      const options = [
        ...shuffled.slice(0, correctPosition),
        correct,
        ...shuffled.slice(correctPosition),
      ];

      return {
        id: `q${index + 1}`,
        options,
        question: question.question,
        sourceTitle: question.sourceTitle,
      };
    }
  );

  await saveNotebook({
    documentId,
    ref: {
      ...notebook.ref,
      quiz: { createdAt: new Date().toISOString(), questions },
    },
    title: notebook.title,
    userId,
  });

  return { questions };
}

/**
 * Grades an answer to a quiz question.
 *
 * The model is given the question, the user's answer and the source passages,
 * and asked to judge it. That is slower than comparing against a stored key and
 * far more useful: it accepts "roughly, because…" as a partly correct answer,
 * and it can explain *why* the answer is wrong with the passage that settles it.
 */
export async function gradeQuizAnswer({
  answer,
  documentId,
  questionId,
  userId,
  versionIndex,
}: {
  answer: string;
  documentId: string;
  questionId: string;
  userId: string;
  versionIndex?: number;
}): Promise<{
  citation?: { index: number; label?: string; title: string };
  feedback: string;
  verdict: "correct" | "partial" | "incorrect";
} | null> {
  const notebook = await loadNotebook({ documentId, userId, versionIndex });

  if (!notebook?.ref.quiz) {
    return null;
  }

  const question = notebook.ref.quiz.questions.find(
    (candidate) => candidate.id === questionId
  );

  if (!question) {
    return null;
  }

  const plan = planRetrieval({
    chunks: notebook.chunks,
    query: question.question,
  });
  const { citations, text } = formatPassages(plan.passages);

  const { output } = await generateText({
    model: getGroundingModel(),
    output: Output.object({
      schema: z.object({
        feedback: z.string().min(1),
        verdict: z.enum(["correct", "partial", "incorrect"]),
      }),
    }),
    prompt: [
      "Grade the answer to the question using only the sources.",
      "Be fair: an answer that is right in substance but imprecise in wording is 'partial', not 'incorrect'.",
      "Give feedback that teaches: say what was right, what was missing or wrong, and which source settles it.",
      "",
      `QUESTION: ${question.question}`,
      question.options ? `OPTIONS: ${question.options.join(" / ")}` : "",
      `STUDENT ANSWER: ${answer}`,
      "",
      "SOURCES:",
      text,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  return {
    citation: citations[0],
    feedback: output.feedback,
    verdict: output.verdict,
  };
}
