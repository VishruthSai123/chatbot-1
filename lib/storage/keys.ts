import { safeStorageFilename } from "@/lib/storage/limits";

/**
 * Storage key layout and ownership, kept free of `server-only` so the boundary
 * can be unit-tested.
 *
 * Every artifact lives under `${userId}/...`. That leading segment is what makes
 * the signed-upload round trip safe: the browser proposes a key, the server
 * refuses to finish any key that does not start with the caller's own id, so a
 * user can never complete an upload into someone else's namespace.
 */

export const GENERAL_FOLDER = "general";

/**
 * A timestamp alone is not unique enough: selecting several files with the same
 * name, or two quick uploads, can land in the same millisecond and would then
 * collide on one storage key — and the upload is `upsert: false`, so the loser
 * would fail outright.
 */
function uniqueToken(): string {
  return crypto.randomUUID().split("-")[0];
}

export function buildStorageKey({
  chatId,
  filename,
  userId,
}: {
  chatId?: string;
  filename: string;
  userId: string;
}): string {
  const folder = chatId ? `${userId}/${chatId}` : `${userId}/${GENERAL_FOLDER}`;
  return `${folder}/${Date.now()}-${uniqueToken()}-${safeStorageFilename(filename)}`;
}

export function isOwnedStorageKey(storageKey: string, userId: string): boolean {
  if (!(storageKey && userId)) {
    return false;
  }
  return storageKey.startsWith(`${userId}/`);
}
