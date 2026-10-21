import { getMessagesByChatId, isValidUUID } from "@/lib/db/queries";
import { collectImageCandidates, matchCandidate } from "@/lib/image/references";
import type { ChatMessage } from "@/lib/types";

/**
 * Turning what the model can see into document ids.
 *
 * The model never sees a document UUID. The AI SDK converts a file part into
 * `{ type: "file", mediaType, filename, data: { type: "url", url } }` — the
 * `documentId` is dropped on the way to the provider. So a model asked to
 * combine "these three photos" can only answer with the *filenames* it was
 * shown.
 *
 * The server, however, can see everything: the persisted message parts still
 * carry the document id. This module bridges the two, by matching a reference
 * the model gave against the attachments in the conversation.
 *
 * The single-image tools already do this in one direction (a filename hint
 * finds one attachment). This does it for a *list*, which is what a batch or a
 * composite needs.
 */

export type ResolvedImageReference = {
  documentId: string;
  name: string;
  url?: string;
};

export type ReferenceResolution = {
  missing: string[];
  resolved: ResolvedImageReference[];
};

/**
 * Resolves a list of references to document ids.
 *
 * A reference that cannot be matched is reported in `missing` rather than
 * aborting the run: a batch of twelve photos where one was renamed should
 * still process eleven.
 */
export async function resolveImageReferences({
  chatId,
  messages,
  references,
}: {
  chatId?: string;
  messages?: ChatMessage[];
  references: string[];
}): Promise<ReferenceResolution> {
  let candidateMessages: unknown[] = messages ?? [];

  if (candidateMessages.length === 0 && chatId && isValidUUID(chatId)) {
    try {
      candidateMessages = await getMessagesByChatId({ id: chatId });
    } catch (error) {
      console.warn(
        "Non-fatal: failed to read messages for image lookup:",
        error
      );
    }
  }

  const candidates = collectImageCandidates(candidateMessages);
  const resolved: ResolvedImageReference[] = [];
  const missing: string[] = [];

  for (const reference of references) {
    if (isValidUUID(reference)) {
      resolved.push({ documentId: reference, name: reference });
      continue;
    }

    const match = matchCandidate(reference, candidates);

    if (match?.documentId) {
      resolved.push({
        documentId: match.documentId,
        name: match.name ?? reference,
        url: match.url,
      });
      continue;
    }

    if (match?.url) {
      // The attachment is known but carries no document id, so it can still be
      // used as a source even though it cannot be edited in place.
      resolved.push({
        documentId: "",
        name: match.name ?? reference,
        url: match.url,
      });
      continue;
    }

    missing.push(reference);
  }

  return { missing, resolved };
}
