/*
 * The state of a research run.
 *
 * A research run has to survive the end of a request. The platform gives a
 * function a few minutes and then stops it, and a report that is lost because
 * the run timed out is worse than no report at all — so the findings are written
 * down as they are made, and a later run continues from there instead of
 * starting over.
 *
 * The envelope is a plain JSON document, exactly like the other families'
 * references: the run is a document the user owns, and it can be read back
 * without any special machinery.
 */

export type ResearchSource = {
  /** The page the finding came from. */
  url: string;
  /** What the page contributed. */
  note: string;
  /** The title, when known. */
  title?: string;
};

export type ResearchRun = {
  /** When the run last moved. */
  updatedAt: string;
  /** The questions already asked, so a continuation does not repeat them. */
  queriesAsked: string[];
  /** The report, once there is one. */
  report?: string;
  /** What the run has established so far. */
  findings: string[];
  /** The pages that were read. */
  sources: ResearchSource[];
  /** The subject of the run. */
  topic: string;
};

const RESEARCH_REF_MARKER = "research-ref:";

export function encodeResearchRun(run: ResearchRun): string {
  return `${RESEARCH_REF_MARKER}${JSON.stringify(run)}`;
}

export function decodeResearchRun(
  content: string | null | undefined
): ResearchRun | null {
  if (!content?.startsWith(RESEARCH_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(RESEARCH_REF_MARKER.length)
    ) as ResearchRun;

    if (!parsed?.topic || !Array.isArray(parsed.findings)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isResearchRun(content: string | null | undefined): boolean {
  return decodeResearchRun(content) !== null;
}

/**
 * True when two topics are the same question.
 *
 * A continuation is "the same question" when the words match closely enough,
 * ignoring case and punctuation. Being a little generous here is right: a
 * continuation that starts from scratch wastes the user's time, and one that
 * attaches to the wrong run only costs a slightly odd report.
 */
export function isSameTopic(a: string, b: string): boolean {
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const left = normalise(a);
  const right = normalise(b);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  // One contained in the other is the same question, more or less specific.
  return left.includes(right) || right.includes(left);
}
