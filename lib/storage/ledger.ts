import "server-only";

import { db } from "@/lib/db/client";
import { artifact } from "@/lib/db/schema";

type ArtifactKind =
  | "audio"
  | "document"
  | "image"
  | "other"
  | "pdf"
  | "presentation"
  | "sheet"
  | "video";

function kindFor(contentType: string, filename: string): ArtifactKind {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (/\.(xlsx?|csv|numbers)$/i.test(filename)) {
    return "sheet";
  }
  if (/\.(pptx?|key)$/i.test(filename)) {
    return "presentation";
  }
  if (/\.(docx?|txt|md|rtf)$/i.test(filename)) {
    return "document";
  }
  return "other";
}

/**
 * Writes the storage ledger row for an object that is already in R2/Supabase.
 *
 * `Artifact` is the existing storage table; the app had stopped writing to it
 * after moving to `Document` refs, which made every storage quota check read
 * zero. This is the one place that puts the row back.
 *
 * Non-fatal by design: the bytes are already stored, so a ledger failure must
 * not turn a successful upload into an error.
 */
export async function recordArtifact(input: {
  chatId?: string;
  contentType: string;
  filename: string;
  retentionDays?: number;
  size: number;
  storageKey: string;
  userId: string;
}): Promise<void> {
  try {
    await db
      .insert(artifact)
      .values({
        chatId: input.chatId,
        detectedMime: input.contentType.slice(0, 128),
        filename: input.filename,
        kind: kindFor(input.contentType, input.filename),
        metadata: { source: "storage-ledger" },
        retentionDays: String(input.retentionDays ?? 30),
        size: String(Math.max(0, Math.floor(input.size))),
        status: "ready",
        storageKey: input.storageKey,
        userId: input.userId,
      })
      .onConflictDoNothing({ target: artifact.storageKey });
  } catch (error) {
    console.warn("Non-fatal: storage ledger write failed:", error);
  }
}
