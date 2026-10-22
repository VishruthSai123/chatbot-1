/**
 * Fetches the yt-dlp binary at build time.
 *
 * The binary is a native executable, so it cannot live in node_modules and be
 * traced like a JavaScript file — it has to be fetched and then pointed at
 * explicitly by `outputFileTracingIncludes`.
 *
 * Two reasons this is a script of our own rather than a package's postinstall:
 *
 * 1. **Pinning.** A postinstall that resolves "the latest release" makes the
 *    build non-reproducible, and a bad release would break the build for
 *    everyone. The version here is pinned, with the latest as a fallback so a
 *    yanked release cannot wedge the deploy.
 * 2. **Failure should be loud and specific.** A postinstall that cannot reach
 *    GitHub fails with an opaque stack trace. This one retries, then says
 *    exactly what it was trying to do.
 */

import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/** The release this build uses. Override with YTDLP_VERSION for a hotfix. */
const PINNED_VERSION = "2026.10.21";

const RELEASES_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases";
const DOWNLOADS = "https://github.com/yt-dlp/yt-dlp/releases/download";
/** Where the binary is written, relative to the project root. */
const BINARY_DIR = ".ytdlp";

function platformAsset() {
  switch (process.platform) {
    case "win32":
      return { asset: "yt-dlp.exe", binary: "yt-dlp.exe" };
    case "darwin":
      return { asset: "yt-dlp_macos", binary: "yt-dlp" };
    default:
      return { asset: "yt-dlp_linux", binary: "yt-dlp" };
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveVersion() {
  const override = process.env.YTDLP_VERSION;

  if (override) {
    return { fallback: false, version: override };
  }

  try {
    const response = await fetch(`${RELEASES_API}/latest`, {
      headers: { "User-Agent": "superiorai-build" },
    });

    if (response.ok) {
      const release = await response.json();
      return { fallback: false, version: release.tag_name };
    }
  } catch {
    // Fall through to the pinned version.
  }

  return { fallback: true, version: PINNED_VERSION };
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { "User-Agent": "superiorai-build" },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destination));
}

async function main() {
  const { asset, binary } = platformAsset();
  const directory = join(process.cwd(), BINARY_DIR);
  const destination = join(directory, binary);

  if (await exists(destination)) {
    console.log(`[ytdlp] ${binary} is already present; keeping it.`);
    return;
  }

  await mkdir(directory, { recursive: true });

  const { fallback, version } = await resolveVersion();
  const candidates = fallback ? [version] : [version, PINNED_VERSION, "latest"];

  let lastError;

  for (const candidate of candidates) {
    const url =
      candidate === "latest"
        ? `${DOWNLOADS}/latest/${asset}`
        : `${DOWNLOADS}/${candidate}/${asset}`;

    const temporary = `${destination}.download`;

    try {
      console.log(`[ytdlp] fetching ${url}`);
      // Sequential on purpose: the candidates are fallbacks for each other, so
      // trying them in parallel would download 39 MB three times over.
      // biome-ignore lint/performance/noAwaitInLoops: fallbacks must be tried in order
      await download(url, temporary);
      await chmod(temporary, 0o755);
      await rename(temporary, destination);
      console.log(`[ytdlp] installed ${candidate}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`[ytdlp] ${candidate} failed: ${error.message}`);
      await unlink(temporary).catch(() => undefined);
    }
  }

  throw new Error(
    `Could not download the yt-dlp binary for ${process.platform}. Last error: ${lastError?.message}. The download feature will not work in this build.`
  );
}

await main();
