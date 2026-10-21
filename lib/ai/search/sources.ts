/**
 * Citation sources.
 *
 * Pure, and deliberately so: the rules that decide what a user sees next to an
 * answer — which sources are worth showing, what they are called, which site
 * they belong to — are the fiddly part, and they should be testable without a
 * model call.
 */

export type GroundingSource = {
  title?: string;
  url: string;
};

/**
 * Grounding hands back `vertexaisearch.cloud.google.com/grounding-api-redirect/…`
 * links.
 *
 * They open the right page when clicked, because Google forwards them, but that
 * hostname tells a reader nothing. For most grounded results the title *is* the
 * site ("en.wikipedia.org", "vercel.com"), so the title is what belongs on
 * screen — with the real host kept as the fallback for the results whose title
 * is a headline instead.
 */
const GROUNDING_REDIRECT_HOST = "grounding-api-redirect";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** True when the URL is one of Google's grounding redirects. */
export function isGroundingRedirect(url: string): boolean {
  // The marker is in the *path*, not the host: the host is
  // "vertexaisearch.cloud.google.com" for every one of them.
  return url.includes(GROUNDING_REDIRECT_HOST);
}

/**
 * Normalises the `sources` a grounded call returns into a citation list.
 *
 * The provider emits one source per grounding chunk; the same page can appear
 * more than once, and a source with no URL is not citable. Both are dropped here
 * rather than at every call site.
 */
export function toGroundingSources(sources: unknown): GroundingSource[] {
  if (!Array.isArray(sources)) {
    return [];
  }

  const seen = new Set<string>();
  const normalised: GroundingSource[] = [];

  for (const source of sources as Array<{
    title?: unknown;
    url?: unknown;
  }>) {
    const url = typeof source?.url === "string" ? source.url : "";

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    normalised.push({
      title: typeof source.title === "string" ? source.title : undefined,
      url,
    });
  }

  return normalised;
}

/** A short, readable label for a source: its title, else its hostname. */
export function sourceLabel(source: GroundingSource): string {
  if (source.title) {
    return source.title;
  }

  return hostOf(source.url);
}

/**
 * The site a source belongs to, for display beside the title.
 *
 * A grounding redirect hides the real site, so the title is used instead —
 * it is the domain in the overwhelming majority of grounded results.
 */
export function sourceHost(source: GroundingSource): string {
  if (isGroundingRedirect(source.url) && source.title) {
    return source.title;
  }

  return hostOf(source.url);
}
