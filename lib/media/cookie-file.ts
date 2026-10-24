/*
 * Reading a cookies.txt.
 *
 * Instagram and Facebook serve most of their content only to a signed-in
 * visitor, so downloading from them needs the user's own session. The
 * conventional way to carry that session to yt-dlp is a Netscape-format
 * `cookies.txt` — the same file a browser extension exports.
 *
 * Pure, so the rules can be tested without a network or a database.
 */

/** One cookie from the file. */
export type CookieEntry = {
  domain: string;
  /** When it expires, as a Unix timestamp. 0 means a session cookie. */
  expires: number;
  name: string;
  path: string;
  secure: boolean;
  value: string;
};

/** What the file contains, without exposing the values. */
export type CookieSummary = {
  /** The domains the cookies belong to, without the leading dot. */
  domains: string[];
  /** How many cookies the file holds. */
  count: number;
};

/** The most a cookie file may weigh. A real one is a few kilobytes. */
export const MAX_COOKIE_FILE_BYTES = 128 * 1024;

/**
 * Parses a Netscape cookies.txt.
 *
 * The format is one cookie per line, seven tab-separated fields:
 * domain, include-subdomains, path, secure, expires, name, value. Lines that
 * start with `#` are comments, except for `#HttpOnly_` lines, which are
 * cookies whose flag the browser hides but yt-dlp still understands.
 *
 * A malformed line is skipped rather than fatal: a stray blank line or a
 * truncated export should not cost the user their whole session.
 */
export function parseCookieFile(text: string): CookieEntry[] {
  const entries: CookieEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    // `#HttpOnly_` marks a real cookie; every other `#` line is a comment.
    const isHttpOnly = line.startsWith("#HttpOnly_");
    const body = isHttpOnly ? line.slice("#HttpOnly_".length) : line;

    if (!isHttpOnly && body.startsWith("#")) {
      continue;
    }

    const fields = body.split("\t");

    if (fields.length < 7) {
      continue;
    }

    const [domain, , path, secure, expires, name, ...rest] = fields;
    const value = rest.join("\t");

    if (!domain || !name) {
      continue;
    }

    entries.push({
      domain: domain.replace(/^\./, ""),
      expires: Number(expires) || 0,
      name: name.trim(),
      path: path || "/",
      secure: secure.toUpperCase() === "TRUE",
      value,
    });
  }

  return entries;
}

/**
 * Summarises a cookie file without revealing the values.
 *
 * The values are session credentials, so nothing that shows them to a user or
 * to a log ever leaves this function.
 */
export function summariseCookieFile(text: string): CookieSummary {
  const entries = parseCookieFile(text);
  const domains = new Set<string>();

  for (const entry of entries) {
    if (entry.domain) {
      domains.add(entry.domain);
    }
  }

  return {
    count: entries.length,
    domains: [...domains].sort(),
  };
}

/**
 * Whether the text looks like a cookie file at all.
 *
 * A file that is not in the Netscape format would be handed to yt-dlp and
 * silently ignored, so it is better to say so plainly.
 */
export function isCookieFile(text: string): boolean {
  return parseCookieFile(text).length > 0;
}

/**
 * The domain a cookie file is meant for.
 *
 * The file may hold cookies for several domains, but the platform being
 * connected to is the one the majority belong to — which is how the site
 * operator's own cookies file is recognised.
 */
export function primaryDomain(text: string): string | undefined {
  const entries = parseCookieFile(text);
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.domain, (counts.get(entry.domain) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = 0;

  for (const [domain, count] of counts) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }

  return best;
}
