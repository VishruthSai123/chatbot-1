import "server-only";

import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyFiles,
  type FormatSummary,
  formatExpression,
  hasCombinedFormat,
} from "@/lib/media/format";
import {
  detectPlatform,
  isAllowedMediaUrl,
  isPublicAddress,
  needsSession,
} from "@/lib/media/url";

/**
 * Driving yt-dlp.
 *
 * The binary is fetched at build time by `scripts/fetch-ytdlp.mjs` into
 * `.ytdlp/`, and is traced into the function by `outputFileTracingIncludes`. It
 * is deliberately its own route rather than part of the shared tools function:
 * a 39 MB native binary in there would slow down every tools request and push
 * that function towards the size ceiling.
 */

/** Where the binary lives, relative to the project root. */
const BINARY_DIR = join(process.cwd(), ".ytdlp");

/** How long a single download may take. */
const DOWNLOAD_TIMEOUT_MS = 90_000;

/** The most a download may produce. Generous for a video, finite for safety. */
const MAX_BYTES = 400 * 1024 * 1024;

export type MediaResult = {
  /** The file's bytes. */
  buffer: Buffer;
  /**
   * The sound track, when the platform publishes the picture and the sound
   * apart.
   *
   * YouTube does; Instagram, TikTok and Facebook do not. Joining the two
   * needs a muxer, which this deployment does not have, so both parts are
   * handed over rather than one of them being passed off as the whole thing.
   */
  companion?: MediaCompanion;
  /** A sensible file name for it. */
  filename: string;
  /** The format actually produced. */
  format: "video" | "audio";
  /** The title the platform reported. */
  title: string;
  /** The page the media came from. */
  sourceUrl: string;
  /** Duration in seconds, when the platform reported it. */
  duration?: number;
  /** The thumbnail, when the platform offered one. */
  thumbnail?: Buffer;
};

/** The sound track that arrived apart from the picture. */
export type MediaCompanion = {
  buffer: Buffer;
  filename: string;
};

/**
 * The path of the yt-dlp binary for this platform.
 */
export function binaryPath(): string {
  return join(
    BINARY_DIR,
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
  );
}

/**
 * Whether the binary is present.
 *
 * The downloader degrades to a clear error rather than crashing when it is not,
 * so a build that skipped the fetch still serves the rest of the app.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    await readFile(binaryPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs yt-dlp and collects what it produced.
 */
async function runYtDlp(
  args: string[],
  timeoutMs = DOWNLOAD_TIMEOUT_MS
): Promise<{ code: number; stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binaryPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("The download took too long and was stopped."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stderr, stdout });
    });
  });
}

/**
 * Refuses a URL whose hostname resolves to a private address.
 *
 * The name can be public and still point inward — that is DNS rebinding, and no
 * check on the name alone can catch it. Resolving the address and checking *that*
 * is what actually closes the hole.
 */
async function assertResolvesToPublicAddress(url: string): Promise<void> {
  const { hostname } = new URL(url);

  let addresses: { address: string }[];

  try {
    addresses = await lookup(hostname, { all: true });
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
}

/**
 * Writes a cookie file for yt-dlp to use.
 *
 * The user's session is a credential, so it goes into a file that is removed
 * the moment the download finishes — whether it finished or failed.
 */
async function writeCookieFile(
  directory: string,
  cookies: string
): Promise<string> {
  const path = join(directory, "cookies.txt");

  await writeFile(path, cookies, "utf8");

  return path;
}

/**
 * Downloads media from a link.
 *
 * The order of the checks is deliberate: the URL is validated *before* anything
 * is spawned, and the hostname is resolved *before* the download starts, so an
 * address that points inward never reaches the fetcher at all.
 *
 * The cookies, when there are any, are the user's own session for the
 * platform — the ones Instagram and Facebook need before they will serve a
 * video. They are written to a file that is deleted with the rest of the
 * temporary directory.
 */
export async function downloadMedia({
  cookies,
  format = "video",
  quality,
  url,
}: {
  /** The user's own session for the platform, in Netscape cookie format. */
  cookies?: string;
  format?: "video" | "audio";
  quality?: number;
  url: string;
}): Promise<MediaResult> {
  if (!isAllowedMediaUrl(url)) {
    throw new Error("That link is not a valid public web address.");
  }

  if (!(await isAvailable())) {
    throw new Error(
      "The downloader is not available in this deployment. It needs the yt-dlp binary, which is fetched at build time."
    );
  }

  await assertResolvesToPublicAddress(url);

  const directory = await mkdtemp(join(tmpdir(), "ytdlp-"));

  try {
    const cookieFile = cookies
      ? await writeCookieFile(directory, cookies)
      : undefined;
    const session = cookieFile ? ["--cookies", cookieFile] : [];

    const info = await runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      ...session,
      url,
    ]);

    if (info.code !== 0) {
      throw new Error(
        sessionHint(url, cookies) ??
          firstUsefulLine(info.stderr) ??
          "That link could not be read. It may be private, deleted, or unsupported."
      );
    }

    let metadata: any;

    try {
      metadata = JSON.parse(info.stdout);
    } catch (cause) {
      throw new Error("The downloader returned something unreadable.", {
        cause,
      });
    }

    if (metadata?._type === "playlist") {
      throw new Error(
        "That link is a playlist. Open the individual video and try again."
      );
    }

    const title = metadata?.title || "download";
    const formats: FormatSummary[] = Array.isArray(metadata?.formats)
      ? metadata.formats
      : [];
    const combined = hasCombinedFormat(formats);

    const download = await runYtDlp([
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--max-filesize",
      `${MAX_BYTES}`,
      // No FFmpeg in this deployment, so the container is left exactly as the
      // platform served it. Without this, yt-dlp tries to "fix" an m4a and fails
      // with "ffprobe and ffmpeg not found".
      "--fixup",
      "never",
      "-f",
      formatExpression({ combined, format, quality }),
      // The name carries the format it came from, so the file can be matched
      // back to the platform's own description of it. That is how a picture and
      // a sound are told apart when they arrive in separate files.
      "-o",
      join(directory, "%(format_id)s.%(ext)s"),
      ...session,
      url,
    ]);

    if (download.code !== 0) {
      throw new Error(
        firstUsefulLine(download.stderr) || "The download failed."
      );
    }

    const produced = await readdir(directory);
    // The cookie file sits in the same directory, and a partial download leaves
    // a ".part" file behind; neither is the media.
    const files = produced.filter(
      (file) => !file.endsWith(".part") && file !== "cookies.txt"
    );

    if (files.length === 0) {
      throw new Error("The download produced no file.");
    }

    /**
     * What came back.
     *
     * A platform that publishes one file carrying both streams gives one
     * entry. A platform that publishes them apart gives two: the picture and
     * the sound. Which is which is read from the platform's own description of
     * the format each file came from, not guessed from the extension — a
     * WebM can be either.
     */
    const classified = classifyFiles(files, formats);
    const picture = classified.find((file) => file.kind !== "audio");
    const sound = classified.find((file) => file.kind === "audio");

    const primary = picture ?? sound;

    if (!primary) {
      throw new Error("The download produced no file.");
    }

    const buffer = await readFile(join(directory, primary.filename));

    if (buffer.length === 0) {
      throw new Error("The download produced an empty file.");
    }

    /**
     * The sound track, when it arrived apart from the picture.
     *
     * This deployment has no muxer, so the two cannot be joined into one file
     * with both. Rather than hand over a silent video and say nothing, both
     * parts are kept and both are offered.
     */
    let companion: MediaCompanion | undefined;

    if (picture && sound) {
      const companionBuffer = await readFile(join(directory, sound.filename));

      if (companionBuffer.length > 0) {
        companion = {
          buffer: companionBuffer,
          filename: sound.filename,
        };
      }
    }

    return {
      buffer,
      companion,
      duration: metadata?.duration,
      filename: primary.filename,
      format,
      sourceUrl: url,
      thumbnail: await fetchThumbnail(metadata?.thumbnail),
      title,
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/**
 * Fetches a thumbnail, if the platform offered one.
 *
 * A thumbnail is a nicety, so a failure here is not an error: the download has
 * already succeeded by this point.
 */
async function fetchThumbnail(
  url: string | undefined
): Promise<Buffer | undefined> {
  if (!url) {
    return;
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    // A thumbnail is a nicety: the download has already succeeded by this point,
    // so a failure here is not worth reporting to the user.
    console.debug("Could not fetch the thumbnail:", cause);
  }
}

/**
 * The first line of yt-dlp's error output that is worth showing a user.
 */
function firstUsefulLine(stderr: string): string | undefined {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("[") &&
        !line.startsWith("WARNING") &&
        !line.startsWith("ERROR: unable to download")
    );

  return lines[0];
}

/**
 * The explanation to give when a platform will not serve its video without a
 * signed-in session.
 *
 * Instagram and Facebook answer an anonymous request with a login page, and
 * yt-dlp's own message ("login required") does not say what to do about it. The
 * answer is to connect the user's own session, so that is what the error says.
 */
function sessionHint(url: string, cookies?: string): string | undefined {
  if (cookies || !needsSession(url)) {
    return;
  }

  const platform = detectPlatform(url);

  return `${platform === "instagram" ? "Instagram" : "Facebook"} only serves its videos to a signed-in visitor. Connect your session from the media sessions panel, then try again.`;
}
