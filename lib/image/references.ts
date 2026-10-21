/**
 * Matching a name the model used to an attachment in the conversation.
 *
 * Pure, and deliberately so: the AI SDK drops the `documentId` when it converts
 * a message for the provider, so a model asked to combine "these three photos"
 * can only answer with the *filenames* it was shown. Turning a filename back
 * into a document id is therefore a lookup the server has to do, and the
 * matching rules are the fiddly part — so they live here, away from the
 * database, where they can be unit tested.
 */

export type ImageCandidate = {
  documentId?: string;
  name?: string;
  url?: string;
};

/**
 * Collects the image attachments in a conversation, newest first.
 *
 * Two shapes are handled: the current `parts` array (which carries the document
 * id) and the older `attachments` array (which does not, but does carry a URL).
 */
export function collectImageCandidates(messages: unknown[]): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];

  for (const message of messages) {
    const parts = (message as any)?.parts;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.type !== "file" && part?.type !== "image") {
          continue;
        }

        const mediaType = part.mediaType ?? part.contentType ?? "";

        if (mediaType && !mediaType.startsWith("image/")) {
          continue;
        }

        const url = part.url ?? part.data ?? part.image;

        if (!url && !part.documentId) {
          continue;
        }

        candidates.push({
          documentId:
            typeof part.documentId === "string" ? part.documentId : undefined,
          name: part.name,
          url,
        });
      }
    }

    const attachments = (message as any)?.attachments;

    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        if (!attachment?.url) {
          continue;
        }

        candidates.push({
          name: attachment.name ?? attachment.pathname,
          url: attachment.url,
        });
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
 * then a URL. That ordering is what makes "photo" match "photo1.jpg" while
 * "photo1.jpg" still resolves to itself.
 */
export function matchCandidate(
  reference: string,
  candidates: ImageCandidate[]
): ImageCandidate | undefined {
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

  // A document id is matched on its exact value, never case-insensitively: it
  // is not a name, and folding case would make two distinct ids collide.
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
