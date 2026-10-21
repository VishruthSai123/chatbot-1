/**
 * Matching a name the model used to an attachment in the conversation.
 *
 * The model never sees a document id. The AI SDK converts a file part into
 * `{ type: "file", mediaType, filename, data: { type: "url" } }` and drops the
 * `documentId` on the way to the provider. So a model asked to "put these three
 * files in a notebook" can only answer with the *filenames* it was shown.
 *
 * The server can see everything: the persisted message parts still carry the
 * document id. This module bridges the two.
 *
 * The matching rules live here, free of any database access, so they can be
 * unit tested directly — they are the fiddly part, and getting them wrong means
 * the model silently acts on the wrong file.
 */

/** A file the conversation knows about. */
export type AttachmentCandidate = {
  documentId?: string;
  mediaType?: string;
  name?: string;
  url?: string;
};

/** Words that match almost everything and so tell a matcher nothing. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Collects the files in a conversation, newest first.
 *
 * Two shapes are handled: the current `parts` array (which carries the document
 * id) and the older `attachments` array (which does not, but does carry a URL).
 */
export function collectAttachmentCandidates(
  messages: unknown[],
  options?: {
    /** Rejects a file. Called with the media type and the name. */
    accept?: (mediaType: string, name: string) => boolean;
  }
): AttachmentCandidate[] {
  const candidates: AttachmentCandidate[] = [];

  const consider = (
    documentId: unknown,
    mediaType: unknown,
    name: unknown,
    url: unknown
  ) => {
    const type = typeof mediaType === "string" ? mediaType : "";
    const label = typeof name === "string" ? name : "";
    const link = typeof url === "string" ? url : "";
    const id = typeof documentId === "string" ? documentId : undefined;

    if (!link && !id) {
      return;
    }

    if (options?.accept && !options.accept(type, label)) {
      return;
    }

    candidates.push({
      documentId: id,
      mediaType: type || undefined,
      name: label || undefined,
      url: link || undefined,
    });
  };

  for (const message of messages as any[]) {
    const parts = message?.parts;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.type !== "file" && part?.type !== "image") {
          continue;
        }

        consider(
          part.documentId,
          part.mediaType ?? part.contentType,
          part.name ?? part.filename,
          part.url ?? part.data ?? part.image
        );
      }
    }

    const attachments = message?.attachments;

    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        consider(
          attachment.documentId,
          attachment.contentType ?? attachment.mediaType,
          attachment.name ?? attachment.pathname,
          attachment.url
        );
      }
    }
  }

  // Newest first, so a re-uploaded file with the same name wins over the old
  // one.
  return candidates.reverse();
}

/**
 * Finds the attachment a reference names.
 *
 * Matching is tried in decreasing order of confidence: an exact name, then a
 * name that contains the reference, then a reference that contains the name,
 * then a document id, then a URL. That ordering is what makes "photo" match
 * "photo1.jpg" while "photo1.jpg" still resolves to itself.
 */
export function matchCandidate(
  reference: string,
  candidates: AttachmentCandidate[]
): AttachmentCandidate | undefined {
  const needle = reference.trim().toLowerCase();

  if (!needle) {
    return;
  }

  const named = candidates.find(
    (candidate) => candidate.name?.toLowerCase() === needle
  );

  if (named) {
    return named;
  }

  const byId = candidates.find(
    (candidate) => candidate.documentId === reference
  );

  if (byId) {
    return byId;
  }

  const containing = candidates.find((candidate) =>
    candidate.name?.toLowerCase().includes(needle)
  );

  if (containing) {
    return containing;
  }

  const contained = candidates.find((candidate) =>
    needle.includes(candidate.name?.toLowerCase() ?? "\u0000")
  );

  if (contained) {
    return contained;
  }

  return candidates.find((candidate) => candidate.url === reference);
}

/** The words of a filename, for a looser match. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}
