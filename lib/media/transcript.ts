import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { binaryPath } from "./download";
import { cuesToTimestampedTranscript, parseVtt } from "./vtt";

/**
 * Getting a video's transcript.
 *
 * A video's words are more useful than its video: a lecture, a talk or an
 * interview becomes a source you can ask questions of, quote with a timestamp,
 * and turn into a quiz.
 *
 * The subtitles are fetched with the same yt-dlp binary the downloader uses,
 * which means no extra dependency and no second service. The auto-generated
 * captions are used, because a manual subtitle track is not available for most
 * videos.
 */

const TRANSCRIPT_TIMEOUT_MS = 60_000;

export type VideoTranscript = {
  /** The transcript, with timecodes inline. */
  text: string;
  /** The video's title. */
  title: string;
  /** The platform's own video id. */
  videoId: string;
};

/**
 * Runs yt-dlp and collects what it produced.
 */
async function runYtDlp(
  args: string[]
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
      reject(new Error("Fetching the transcript took too long."));
    }, TRANSCRIPT_TIMEOUT_MS);

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
 * Fetches a video's transcript.
 *
 * The subtitle languages are tried in turn, because a video may have captions
 * in one language but not another, and the automatic English track is the one
 * most videos actually have.
 */
export async function fetchVideoTranscript({
  url,
}: {
  url: string;
}): Promise<VideoTranscript | null> {
  const directory = await mkdtemp(join(tmpdir(), "ytsub-"));

  try {
    const info = await runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      url,
    ]);

    let metadata: any;

    try {
      metadata = JSON.parse(info.stdout);
    } catch {
      return null;
    }

    if (metadata?._type === "playlist") {
      return null;
    }

    // The auto-generated track first, then any manual track.
    const downloads = await runYtDlp([
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      "en,en-orig,en-US,en-GB",
      "--sub-format",
      "vtt",
      "-o",
      join(directory, "%(id)s.%(ext)s"),
      url,
    ]);

    if (downloads.code !== 0) {
      return null;
    }

    const files = await readdir(directory);
    const subtitle = files.find((file) => file.endsWith(".vtt"));

    if (!subtitle) {
      return null;
    }

    const vtt = await readFile(join(directory, subtitle), "utf8");
    const cues = parseVtt(vtt);
    const text = cuesToTimestampedTranscript(cues);

    if (!text) {
      return null;
    }

    return {
      text,
      title: metadata?.title ?? "Video",
      videoId: metadata?.id ?? "",
    };
  } catch (error) {
    console.warn("Could not fetch the video transcript:", error);
    return null;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
