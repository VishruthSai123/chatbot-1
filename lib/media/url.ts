/**
 * Working out what a media link is and whether it may be fetched.
 *
 * Pure, so the rules can be tested without a network.
 *
 * The validation here is a safety boundary, not a formality. The downloader
 * takes a URL from a conversation and hands it to a process that will fetch it.
 * Without a check, that process could be pointed at an address inside the
 * deployment's own network — the classic server-side request forgery. The rules
 * below are deliberately narrow: public web addresses only, never a private or
 * loopback one.
 */

export type MediaPlatform =
  | "youtube"
  | "vimeo"
  | "soundcloud"
  | "twitter"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "unknown";

export type MediaFormat = "video" | "audio";

export type MediaRequest = {
  format: MediaFormat;
  /** 1 is best, 2 is lower. */
  quality?: number;
  url: string;
};

/** Hostnames that name a known platform. */
const PLATFORM_HOSTS: [RegExp, MediaPlatform][] = [
  [
    /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/,
    "youtube",
  ],
  [/(^|\.)vimeo\.com$/, "vimeo"],
  [/(^|\.)soundcloud\.com$/, "soundcloud"],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, "twitter"],
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [
    /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$|(^|\.)messenger\.com$/,
    "facebook",
  ],
];

/**
 * The platforms whose videos can be read as a transcript.
 *
 * These are the ones yt-dlp can pull a caption track out of, which is what
 * turns a link into a source you can ask questions of.
 */
const TRANSCRIPT_PLATFORMS = new Set<MediaPlatform>([
  "youtube",
  "vimeo",
  "instagram",
  "tiktok",
  "facebook",
]);

/** Schemes we are willing to fetch. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Hostnames that must never be fetched.
 *
 * A short list rather than a complete blocklist, because the real defence is
 * the address check below: anything that resolves to a private range is refused
 * whatever its name.
 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

/**
 * True when a hostname is a public address.
 *
 * This is the important check. A hostname can look entirely public and still
 * resolve to `10.0.0.1`, and it can be a public name that is rebound to a
 * private address — the "DNS rebinding" case, which no name-based check can
 * catch. Resolving the address and checking *that* is what closes the hole.
 */
export function isPublicAddress(address: string): boolean {
  const version = netVersion(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);

    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }

    const [a, b] = parts;

    // 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
    // 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24,
    // 224/4 (multicast) and 240/4 (reserved).
    if (a === 0 || a === 10 || a === 127) {
      return false;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return false;
    }
    if (a === 169 && b === 254) {
      return false;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return false;
    }
    if (a === 192 && b === 168) {
      return false;
    }
    if (a === 192 && b === 0) {
      return false;
    }
    if (a === 198 && (b === 18 || b === 19)) {
      return false;
    }
    if (a === 198 && b === 51) {
      return false;
    }
    if (a === 203 && b === 0) {
      return false;
    }
    if (a >= 224) {
      return false;
    }

    return true;
  }

  if (version === 6) {
    const lower = address.toLowerCase();

    // ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link local), and the
    // IPv4-mapped forms that carry a v4 address inside them.
    if (lower === "::1" || lower === "::") {
      return false;
    }
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
      return false;
    }
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return false;
    }
    if (lower.startsWith("::ffff:")) {
      return isPublicAddress(lower.slice(7));
    }

    return true;
  }

  return false;
}

/** Which IP version an address is, or 0 when it is neither. */
function netVersion(address: string): 4 | 6 | 0 {
  if (address.includes(":")) {
    return 6;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return 4;
  }

  return 0;
}

/**
 * The platform a URL belongs to.
 */
export function detectPlatform(url: string): MediaPlatform {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }

  for (const [pattern, platform] of PLATFORM_HOSTS) {
    if (pattern.test(hostname)) {
      return platform;
    }
  }

  return "unknown";
}

/**
 * Whether a URL is one we are willing to hand to the downloader.
 *
 * The scheme and the hostname are checked here; the *address* the hostname
 * resolves to is checked at fetch time, because that is the only way to catch a
 * name that points inward.
 */
export function isAllowedMediaUrl(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!hostname || BLOCKED_HOSTS.has(hostname)) {
    return false;
  }

  // A bare IPv4 literal in the URL is checked directly: there is no name to
  // resolve, so the address check has to happen here.
  if (netVersion(hostname) !== 0) {
    return isPublicAddress(hostname);
  }

  return true;
}

/**
 * True when a URL points at a video platform.
 *
 * A video's *words* are what make it useful as a source, so a video link is read
 * as its transcript rather than as a page of links and comments.
 */
export function isVideoUrl(url: string): boolean {
  return TRANSCRIPT_PLATFORMS.has(detectPlatform(url));
}

/**
 * Whether a platform needs the user's own session to be readable.
 *
 * Instagram and Facebook serve most content only to a signed-in visitor, so a
 * download from them needs the user's cookies. TikTok and YouTube usually do
 * not, and asking for cookies that are not needed is a needless ask.
 */
export function needsSession(url: string): boolean {
  const platform = detectPlatform(url);

  return platform === "instagram" || platform === "facebook";
}

/**
 * The file name a download should be saved under.
 */
export function downloadFileName(title: string, extension: string): string {
  const base = title
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);

  return `${base || "download"}.${extension}`;
}
