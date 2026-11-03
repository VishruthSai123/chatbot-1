/*
 * The outbound proxy, if the deployment has one.
 *
 * Pure, so the precedence rules can be tested without touching the real
 * environment.
 *
 * This is the fix for address-based blocks that does not involve the user:
 * YouTube and Instagram decide whether to serve a request partly by where it
 * comes from, and a serverless function comes from a datacenter. A proxy makes
 * the request look ordinary — once, for everyone.
 */

/** The environment keys that may hold a proxy, in order of preference. */
const PROXY_KEYS = ["YTDLP_PROXY", "HTTPS_PROXY", "https_proxy"] as const;

/**
 * The proxy URL, or nothing when none is configured.
 *
 * `YTDLP_PROXY` wins so a deployment can route only the downloader through a
 * proxy without changing how the rest of the app reaches the network.
 */
export function proxyFromEnv(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  for (const key of PROXY_KEYS) {
    const value = env[key]?.trim();

    if (value) {
      return value;
    }
  }
}

/**
 * The yt-dlp arguments that apply a proxy.
 *
 * An empty array when none is configured, so it can be spread unconditionally.
 */
export function proxyArgsFromEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  const proxy = proxyFromEnv(env);

  return proxy ? ["--proxy", proxy] : [];
}
