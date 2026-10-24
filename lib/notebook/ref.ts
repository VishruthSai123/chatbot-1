/*
 * How a notebook is stored.
 *
 * A notebook is one document whose content lists its sources. Each source is a
 * *reference* — an uploaded file's document id, or a URL — never a copy. That
 * means adding a source does not duplicate a file, editing a source's document
 * is reflected in the notebook, and a notebook stays small however big its
 * sources are.
 *
 * The envelope is deliberately plain JSON with a marker prefix, exactly like
 * `image-ref:`, `pdf-ref:` and `sheet-ref:`. One convention for the whole app.
 */

/** A source in a notebook. */
export type NotebookSource = {
  /** When the source was added. */
  addedAt: string;
  /** Where the source lives. */
  kind: "file" | "url";
  /** The media type, when known. */
  mediaType?: string;
  /** The document id, for a file source. */
  documentId?: string;
  /** The title shown in the source list. */
  title: string;
  /** The URL, for a web source. */
  url?: string;
  /** How much text was extracted. Advisory. */
  chars?: number;
  /** Whether the source could be read. */
  readable?: boolean;
};

import type { QuizQuestion } from "@/lib/quiz/schema";

export type { QuizQuestion } from "@/lib/quiz/schema";

/** One question in a quiz. */
export type NotebookQuizQuestion = QuizQuestion & {
  id: string;
};

/** A generated deliverable, kept so the studio can show it again later. */
export type NotebookDeliverable = {
  content: string;
  createdAt: string;
  /** "summary" | "study_guide" | "faq" | "timeline" | "briefing". */
  kind: string;
  title: string;
};

export type NotebookRef = {
  /** The generated quiz, if any. */
  quiz?: {
    createdAt: string;
    questions: NotebookQuizQuestion[];
  };
  /** The most recent deliverable, if any. */
  deliverable?: NotebookDeliverable;
  /** The sources. */
  sources: NotebookSource[];
  title?: string;
};

const NOTEBOOK_REF_MARKER = "notebook-ref:";

export function encodeNotebookRef(ref: NotebookRef): string {
  return `${NOTEBOOK_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeNotebookRef(
  content: string | null | undefined
): NotebookRef | null {
  if (!content?.startsWith(NOTEBOOK_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(NOTEBOOK_REF_MARKER.length)
    ) as NotebookRef;

    if (!parsed || !Array.isArray(parsed.sources)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isNotebookRef(content: string | null | undefined): boolean {
  return decodeNotebookRef(content) !== null;
}

/** The kinds of deliverable a notebook can produce. */
export const NOTEBOOK_DELIVERABLES = [
  "summary",
  "study_guide",
  "faq",
  "timeline",
  "briefing",
] as const;

export type NotebookDeliverableKind = (typeof NOTEBOOK_DELIVERABLES)[number];
