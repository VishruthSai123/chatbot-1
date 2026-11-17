/**
 * A shared file that is waiting for the user to sign in.
 *
 * The native drop hand-off stores its files under a short-lived token. The
 * composer cannot keep React state across the login page, so the token is kept
 * in session storage and re-imported when the user comes back. It is scoped to
 * the current path so a pending share never leaks into a different chat.
 */

const STORAGE_KEY = "spire:pending-share";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingShare = {
  token: string;
  path: string;
  createdAt: number;
};

/**
 * Validates a raw stored value. Exported separately so the rules can be tested
 * without a browser storage object.
 */
export function parsePendingShare(
  raw: string | null,
  path: string,
  now: number
): PendingShare | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingShare>;
    if (typeof parsed.token !== "string" || parsed.token.trim() === "") {
      return null;
    }
    if (parsed.path !== path) {
      return null;
    }
    if (typeof parsed.createdAt !== "number") {
      return null;
    }
    if (now - parsed.createdAt > MAX_AGE_MS) {
      return null;
    }
    return {
      createdAt: parsed.createdAt,
      path: parsed.path,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

export function savePendingShare(
  token: string,
  path: string
): PendingShare | null {
  if (typeof window === "undefined") {
    return null;
  }

  const pending: PendingShare = { createdAt: Date.now(), path, token };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return pending;
  } catch {
    return null;
  }
}

export function readPendingShare(path: string): PendingShare | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const pending = parsePendingShare(raw, path, Date.now());
    if (!pending && raw) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
    return pending;
  } catch {
    return null;
  }
}

export function clearPendingShare(token?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (token) {
      const current = parsePendingShare(
        window.sessionStorage.getItem(STORAGE_KEY),
        window.location.pathname,
        Date.now()
      );
      if (current && current.token !== token) {
        return;
      }
    }
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in private browsing. The composer
    // still works; only cross-page persistence is lost.
  }
}
