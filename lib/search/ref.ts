/**
 * The stored shape of a search/research result in the side panel.
 *
 * Search results are not database documents: they are a snapshot of what the
 * model just read. Encoding them into a small `search-ref:` envelope lets the
 * existing artifact panel render them without a `/api/document` round-trip or a
 * second persistence path.
 */

export type SearchSource = {
  title?: string;
  url: string;
};

export type SearchArtifactKind = "page" | "research" | "web";

export type SearchArtifactRef = {
  /** The answer for a web search, or the page text for a page read. */
  answer?: string;
  /** Research depth, when the result came from `research`. */
  depth?: string;
  kind: SearchArtifactKind;
  /** The original question or topic. */
  query?: string;
  /** The long report from `research`. */
  report?: string;
  sources: SearchSource[];
  /** The page that was read, when the result came from `readUrl`. */
  url?: string;
};

const SEARCH_REF_MARKER = "search-ref:";

export function encodeSearchRef(ref: SearchArtifactRef): string {
  return `${SEARCH_REF_MARKER}${JSON.stringify(ref)}`;
}

export function decodeSearchRef(
  content: string | null | undefined
): SearchArtifactRef | null {
  if (!content?.startsWith(SEARCH_REF_MARKER)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      content.slice(SEARCH_REF_MARKER.length)
    ) as Partial<SearchArtifactRef>;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const kind =
      parsed.kind === "research" || parsed.kind === "page"
        ? parsed.kind
        : "web";

    const sources = Array.isArray(parsed.sources)
      ? parsed.sources
          .filter(
            (source): source is SearchSource =>
              Boolean(source) &&
              typeof source === "object" &&
              typeof source.url === "string" &&
              source.url.length > 0
          )
          .map((source) => ({
            title: typeof source.title === "string" ? source.title : undefined,
            url: source.url,
          }))
      : [];

    return {
      answer: typeof parsed.answer === "string" ? parsed.answer : undefined,
      depth: typeof parsed.depth === "string" ? parsed.depth : undefined,
      kind,
      query: typeof parsed.query === "string" ? parsed.query : undefined,
      report: typeof parsed.report === "string" ? parsed.report : undefined,
      sources,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
    };
  } catch {
    return null;
  }
}
