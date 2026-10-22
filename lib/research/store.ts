import "server-only";

import { getRecentDocumentsByKind, saveDocument } from "@/lib/db/queries";
import {
  decodeResearchRun,
  encodeResearchRun,
  isSameTopic,
  type ResearchRun,
} from "./ref";

/**
 * Finding and saving a research run.
 *
 * A run lives in an ordinary document, so it is owned, versioned and readable
 * like everything else the app stores. There is no separate job table and no
 * scheduler: a continuation is just the next request finding the last run.
 */

/** How many recent documents are searched for a run to continue. */
const SEARCH_LIMIT = 25;

/**
 * Finds the run a continuation should pick up.
 *
 * The most recent run on the same topic wins. If there is none, this returns
 * null and the caller starts a new run.
 */
export async function findResearchRun({
  topic,
  userId,
}: {
  topic: string;
  userId: string;
}): Promise<{ documentId: string; run: ResearchRun } | null> {
  const documents = await getRecentDocumentsByKind({
    kind: "text",
    limit: SEARCH_LIMIT,
    userId,
  });

  for (const document of documents) {
    const run = decodeResearchRun(document.content);

    if (run && isSameTopic(run.topic, topic)) {
      return { documentId: document.id, run };
    }
  }

  return null;
}

/**
 * Writes a run back.
 *
 * A run that already exists is written as a new version of the same document,
 * so the history of how a report was built is kept.
 */
export async function saveResearchRun({
  documentId,
  run,
  userId,
}: {
  documentId?: string;
  run: ResearchRun;
  userId: string;
}): Promise<string> {
  const id = documentId ?? crypto.randomUUID();

  await saveDocument({
    content: encodeResearchRun(run),
    id,
    kind: "text",
    title: `Research: ${run.topic}`,
    userId,
  });

  return id;
}
