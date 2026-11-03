/*
 * Reading DuckDuckGo's result page.
 *
 * Pure, so the rules can be tested against a saved page instead of the live
 * service — which is both faster and the only way to test the awkward cases
 * (a wrapped link, a duplicate, an ad) on demand.
 */

import { htmlToText } from "@/lib/net/html";

/** Where the search lives, used to resolve relative links. */
const SEARCH_URL = "https://html.duckduckgo.com/html/";

export type SearchHit = {
  snippet: string;
  title: string;
  url: string;
};

/**
 * DuckDuckGo sometimes wraps an outbound link in `/l/?uddg=<encoded url>`.
 *
 * A redirect wrapper is useless as a citation, so the real destination is
 * unwrapped. A link it cannot unwrap is returned as `null` rather than as a
 * half-decoded string.
 */
export function unwrapUrl(href: string): string | null {
  // A result link is always absolute or protocol-relative. Anything else is
  // text that happened to be in an href, not a destination.
  if (!(/^https?:\/\//i.test(href) || href.startsWith("//"))) {
    return null;
  }

  try {
    const url = new URL(href, SEARCH_URL);

    if (url.pathname.startsWith("/l/")) {
      const target = url.searchParams.get("uddg");

      return target ? decodeURIComponent(target) : null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/** True for a normal web page rather than an ad or an internal link. */
export function isResultUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.hostname.includes("duckduckgo.com")
    );
  } catch {
    return false;
  }
}

/**
 * Parses the results out of a DuckDuckGo HTML page.
 *
 * Each result lives in a block whose class contains `result__body` — the
 * attribute also carries other classes, so the match cannot be exact. Within a
 * block, the title anchor carries `result__a` and the snippet `result__snippet`,
 * and the two attributes may appear in either order.
 */
export function parseDuckDuckGoResults(
  html: string,
  maxResults = 6
): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/result__body/i).slice(1);

  for (const block of blocks) {
    if (hits.length >= maxResults) {
      break;
    }

    const anchor =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

    if (!anchor) {
      continue;
    }

    const tag = /<a[^>]*>/i.exec(anchor[0])?.[0] ?? "";
    const href = /href="([^"]+)"/i.exec(tag)?.[1];

    if (!href) {
      continue;
    }

    const url = unwrapUrl(href);

    if (!url || !isResultUrl(url) || seen.has(url)) {
      continue;
    }

    const snippet =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

    seen.add(url);
    hits.push({
      // A title and a snippet are small fragments of HTML — the result is
      // often wrapped in <b> — so they are reduced to text the same way a
      // whole page is.
      snippet: snippet ? htmlToText(snippet[1]) : "",
      title: htmlToText(anchor[1]) || url,
      url,
    });
  }

  return hits;
}

/**
 * Parses the results out of DuckDuckGo's *Lite* page.
 *
 * Lite is a different endpoint with a different shape — a table of anchors
 * carrying `result-link`, each followed by a `result-snippet` cell. It exists
 * because the two endpoints are blocked independently: when the HTML one
 * answers 403, this one sometimes still answers.
 */
export function parseDuckDuckGoLite(html: string, maxResults = 6): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // Both quote styles appear in the wild.
  const anchorPattern =
    /<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorPattern.exec(html);

  while (match !== null && hits.length < maxResults) {
    const tag = /<a[^>]*>/i.exec(match[0])?.[0] ?? "";
    const href = /href=['"]([^'"]+)['"]/i.exec(tag)?.[1];

    if (href) {
      const url = unwrapUrl(href);

      if (url && isResultUrl(url) && !seen.has(url)) {
        // The snippet is the next cell after the link.
        const rest = html.slice(anchorPattern.lastIndex);
        const snippet =
          /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(
            rest
          );

        seen.add(url);
        hits.push({
          snippet: snippet ? htmlToText(snippet[1]) : "",
          title: htmlToText(match[1]) || url,
          url,
        });
      }
    }

    match = anchorPattern.exec(html);
  }

  return hits;
}
