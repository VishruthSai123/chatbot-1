import { errorStatusCode } from "./observability";

/**
 * A provider-level failure that a second provider could plausibly fix.
 *
 * A 400 (malformed image, bad tool schema) is our bug and must not be hidden by
 * a fallback. Auth, quota, rate-limit, timeout and 5xx failures are safe to
 * retry elsewhere.
 */
export function shouldUseFallback(error: unknown): boolean {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return false;
  }

  const status = errorStatusCode(error);
  if (status !== undefined) {
    return [401, 402, 403, 404, 408, 429, 500, 502, 503, 504].includes(status);
  }

  const name =
    error && typeof error === "object"
      ? (error as { name?: string }).name
      : undefined;

  return name === "LoadAPIKeyError" || name === "APICallError";
}
