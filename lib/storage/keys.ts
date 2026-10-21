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

/**
 * Extracts a Supabase storage key from an artifact URL, path, or signed URL.
 */
export function extractStorageKey(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== "string") {
    return null;
  }

  const clean = urlOrPath.trim();

  // 1. Matches: /storage/v1/object/(sign|public|authenticated)/<bucket>/<key>?...
  const objectMatch = clean.match(
    /\/storage\/v1\/object\/(?:sign|public|authenticated)\/[^/]+\/([^?#]+)/i
  );
  if (objectMatch?.[1]) {
    try {
      return decodeURIComponent(objectMatch[1]);
    } catch {
      return objectMatch[1];
    }
  }

  // 2. Matches generic /object/(sign|public|authenticated)/<bucket>/<key>?...
  const genericMatch = clean.match(
    /\/object\/(?:sign|public|authenticated)\/[^/]+\/([^?#]+)/i
  );
  if (genericMatch?.[1]) {
    try {
      return decodeURIComponent(genericMatch[1]);
    } catch {
      return genericMatch[1];
    }
  }

  // 3. Matches: .../artifacts/<key>?...
  const match = clean.match(/(?:^|\/)artifacts\/([^?#]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  // 4. If it's a full URL or data URI that didn't match Supabase storage patterns, return null
  if (
    clean.startsWith("http://") ||
    clean.startsWith("https://") ||
    clean.startsWith("data:")
  ) {
    return null;
  }

  // 5. Matches relative storage key pattern: <userId>/<folder>/<filename>
  const parts = clean.split("/");
  if (parts.length >= 2 && !clean.includes("..")) {
    const [withoutQuery] = clean.split("?");
    const [withoutHash] = (withoutQuery ?? "").split("#");
    try {
      return decodeURIComponent(withoutHash);
    } catch {
      return withoutHash;
    }
  }

  return null;
}
