/**
 * Google AI credentials, ordered for rolling rotation.
 *
 * The primary credential is used first. `*_NEXT` and the comma-separated pool
 * are tried only when the earlier credential fails with a retryable provider
 * error. This lets an operator add a new key, verify it, promote it, and remove
 * the old one without a client release.
 *
 * Pure on purpose: no `server-only`, no logging, and no secret values in tests.
 */

export type GoogleKeyEnvironment = {
  GEMINI_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  GEMINI_API_KEY_NEXT?: string;
  GOOGLE_GENERATIVE_AI_API_KEY_NEXT?: string;
  GEMINI_API_KEYS?: string;
};

function listValues(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseGoogleApiKeys(
  environment: GoogleKeyEnvironment
): string[] {
  const candidates = [
    environment.GEMINI_API_KEY,
    environment.GOOGLE_GENERATIVE_AI_API_KEY,
    environment.GEMINI_API_KEY_NEXT,
    environment.GOOGLE_GENERATIVE_AI_API_KEY_NEXT,
    ...listValues(environment.GEMINI_API_KEYS),
  ];

  const seen = new Set<string>();
  const keys: string[] = [];

  for (const candidate of candidates) {
    const key = candidate?.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

export function readGoogleApiKeys(
  environment?: GoogleKeyEnvironment
): string[] {
  return parseGoogleApiKeys(
    environment ?? (process.env as GoogleKeyEnvironment)
  );
}
