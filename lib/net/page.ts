import "server-only";

import { lookup } from "node:dns/promises";

import { isAllowedMediaUrl, isPublicAddress } from "@/lib/media/url";
import { htmlToText } from "@/lib/net/html";

/*
 * Fetching a page a user named.
 *
 * The URL comes from a conversation, so it is untrusted input that the server
 * will make a request to. Without a check, it could point at the deployment's
 * own network or at a cloud metadata endpoint — the classic server-side
 * request forgery.
 *
 * The check has two stages, because a name alone is not enough:
 *
 * 1. The scheme, host and any bare IP are checked before anything is fetched.
 * 2. The hostname is resolved and the *address* is checked. A public name can
 *    resolve to `10.0.0.1`, and it can be rebound between the check and the
 *    request — which is why the check happens immediately before each hop.
 */

/** How many redirects a page read will follow. */
const MAX_REDIRECTS = 4;

/** How long a page read may take, in total. */
const FETCH_TIMEOUT_MS = 15_000;

/** The most a page may produce, so one page cannot swamp the context. */
const MAX_PAGE_CHARS = 30_000;

/** A browser-like identity, because many sites serve bots a stub page. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** True when a host is a bare address rather than a name. */
function isAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * Checks that a URL is one the server may fetch.
 *
 * Synchronous, and deliberately cheap: it rejects the obvious cases before a
 * DNS lookup is even attempted.
 */
export function assertPublicUrl(url: string): URL {
  if (!isAllowedMediaUrl(url)) {
    throw new Error("That is not a public web address.");
  }

  return new URL(url);
}

/**
 * Checks that a URL resolves to a public address.
 *
 * This is the stage that catches a name pointing inward. It is run before every
 * hop of a redirect chain, not just once, because a redirect is a second URL
 * that the first one chose.
 */
export async function assertPublicHost(url: string): Promise<URL> {
  const parsed = assertPublicUrl(url);

  if (isAddress(parsed.hostname)) {
    return parsed;
  }

  let addresses: { address: string }[];

  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch (cause) {
    throw new Error("That address could not be resolved.", { cause });
  }

  if (addresses.length === 0) {
    throw new Error("That address could not be resolved.");
  }

  for (const entry of addresses) {
    if (!isPublicAddress(entry.address)) {
      throw new Error(
        "That address is not a public one and cannot be fetched."
      );
    }
  }

  return parsed;
}

export { htmlToText } from "@/lib/net/html";

/**
 * Fetches a page and returns its text.
 *
 * Redirects are followed by hand rather than by `fetch`, because each new URL
 * has to pass the same address check — otherwise a public URL could redirect
 * the server into its own network.
 */
export async function fetchPageText(
  url: string,
  { maxChars = MAX_PAGE_CHARS }: { maxChars?: number } = {}
): Promise<{ text: string; url: string }> {
  let current = await assertPublicHost(url);
  const deadline = Date.now() + FETCH_TIMEOUT_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new Error("The page took too long to respond.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    let response: Response;

    try {
      // biome-ignore lint/performance/noAwaitInLoops: a redirect chain has to be walked one hop at a time, because each hop's address must be checked before the next one is known
      response = await fetch(current, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Language": "en",
          "User-Agent": USER_AGENT,
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("That page redirected to nowhere.");
      }

      current = await assertPublicHost(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`That page answered with ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    const text = contentType.includes("html")
      ? htmlToText(body)
      : body.replace(/\s+/g, " ").trim();

    if (!text) {
      throw new Error("That page had no readable text.");
    }

    return { text: text.slice(0, maxChars), url: current.toString() };
  }

  throw new Error("That page redirected too many times.");
}
