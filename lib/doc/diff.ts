import { DIFF_DELETE, DIFF_INSERT, diff_match_patch } from "diff-match-patch";

/**
 * Comparing two documents.
 *
 * Two granularities, because they answer different questions:
 *
 * - **line** diff answers "what changed structurally?" — a moved paragraph, a
 *   rewritten section, a deleted block. This is what a side-by-side view shows.
 * - **word** diff answers "what exactly changed in this sentence?" — used to
 *   highlight the edit *within* a changed line.
 *
 * The line diff uses the library's own trick: map each line to a character,
 * diff the characters, then map back. That makes the diff line-aligned without
 * any of the fuzzy matching that would otherwise smear a paragraph change across
 * the document.
 */

export type DiffKind = "equal" | "insert" | "delete";

export type DiffSegment = {
  kind: DiffKind;
  text: string;
};

/** The library's numeric diff types, named. */
const KIND_BY_CODE: Record<number, DiffKind> = {
  "-1": "delete",
  "0": "equal",
  "1": "insert",
};
/** How many words a minute. The usual figure for adult silent reading. */
const READING_WORDS_PER_MINUTE = 238;

/** How many words a minute. The usual figure for presenting aloud. */
const SPEAKING_WORDS_PER_MINUTE = 130;

function toSegments(diffs: [number, string][]): DiffSegment[] {
  return diffs.map(([code, text]) => ({
    kind: KIND_BY_CODE[code] ?? "equal",
    text,
  }));
}

/**
 * A line-by-line diff.
 *
 * The segments come back in reading order: deletions and insertions are
 * interleaved where the change happened, so a reader can see what was replaced
 * by what.
 */
export function diffLines(oldText: string, newText: string): DiffSegment[] {
  const dmp = new diff_match_patch();
  const lineToChar = dmp.diff_linesToChars_(oldText, newText);
  const diffs = dmp.diff_main(lineToChar.chars1, lineToChar.chars2, false);

  dmp.diff_charsToLines_(diffs, lineToChar.lineArray);
  dmp.diff_cleanupSemantic(diffs);

  return toSegments(diffs);
}

/**
 * A word-by-word diff of two pieces of text.
 */
export function diffWords(oldText: string, newText: string): DiffSegment[] {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(oldText, newText, false);

  dmp.diff_cleanupSemantic(diffs);

  return toSegments(diffs);
}

/**
 * The parts of a line diff that actually changed, and by how much.
 *
 * Used for a summary: "12 lines added, 3 removed" is what a reader wants
 * before they look at the detail.
 */
export function summariseDiff(segments: DiffSegment[]): {
  added: number;
  removed: number;
  unchanged: number;
} {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const segment of segments) {
    const lines = segment.text.split("\n").length - 1;

    if (segment.kind === "insert") {
      added += lines;
    } else if (segment.kind === "delete") {
      removed += lines;
    } else {
      unchanged += lines;
    }
  }

  return { added, removed, unchanged };
}

/**
 * Reads a document's statistics.
 *
 * The reading and speaking times are the ones people actually want — "this is
 * a 12-minute read" — so they are computed from the word count rather than
 * left for the reader to work out.
 */
export function readingStats(text: string): {
  characters: number;
  charactersNoSpaces: number;
  minutesToRead: number;
  minutesToSpeak: number;
  paragraphs: number;
  sentences: number;
  words: number;
} {
  const trimmed = text.trim();

  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;

  // A sentence ends with a terminator. Counting terminators is more robust than
  // splitting on ".", which breaks on decimals, ellipses and abbreviations.
  const sentences = trimmed
    ? (trimmed.match(/[.!?]+(?=\s|$)/g) ?? []).length || 1
    : 0;

  const paragraphs = trimmed
    ? trimmed.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).length
    : 0;

  return {
    characters,
    charactersNoSpaces,
    minutesToRead: Math.max(1, Math.round(words / READING_WORDS_PER_MINUTE)),
    minutesToSpeak: Math.max(1, Math.round(words / SPEAKING_WORDS_PER_MINUTE)),
    paragraphs,
    sentences,
    words,
  };
}

/** A heading in a document's outline. */
export type OutlineNode = {
  /** The heading text. */
  text: string;
  /** 1 for an H1, 2 for an H2, and so on. */
  level: number;
  children: OutlineNode[];
};

/**
 * Builds a heading tree from markdown.
 *
 * Only ATX headings are recognised (`# Heading`), which is what a document
 * written in a text editor actually contains. Setext headings are rare enough in
 * real files that supporting them would be speculative.
 */
export function extractOutline(markdown: string): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (!match) {
      continue;
    }

    const node: OutlineNode = {
      children: [],
      level: match[1].length,
      text: match[2].trim(),
    };

    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= node.level) {
      stack.pop();
    }

    const parent = stack.at(-1);

    if (parent) {
      parent.children.push(node);
    } else {
      root.push(node);
    }

    stack.push(node);
  }

  return root;
}

/** Counts the headings at each level, for a quick structural summary. */
export function outlineCounts(outline: OutlineNode[]): Record<number, number> {
  const counts: Record<number, number> = {};

  const walk = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      counts[node.level] = (counts[node.level] ?? 0) + 1;
      walk(node.children);
    }
  };

  walk(outline);

  return counts;
}

/** The diff library's numeric codes, for a caller that wants to filter raw diffs. */
export const DIFF_CODES = { delete: DIFF_DELETE, insert: DIFF_INSERT };
