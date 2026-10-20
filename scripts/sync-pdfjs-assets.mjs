/**
 * Copies pdf.js runtime assets into `public/pdfjs/`.
 *
 * pdf.js needs four things at runtime that a bundler cannot inline: the render
 * worker (a real `Worker`, so it must be same-origin), the Adobe CMaps (for CJK
 * encodings), the standard font data (for PDFs that embed no fonts), and the wasm
 * codecs (JPX/JBIG2 images — common in scans).
 *
 * Serving them from `public/` rather than a CDN is deliberate: this app is
 * zero-SaaS for file processing, and a CDN fetch would also be the one part of the
 * studio that breaks offline.
 *
 * Run from `predev` and `prebuild`. Copies are skipped when the destination is
 * already current, so repeated dev restarts cost nothing.
 */
import { cp, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let packageRoot;
try {
  packageRoot = dirname(require.resolve("pdfjs-dist/package.json"));
} catch {
  // A production install without devDependencies still has pdfjs-dist (it is a
  // runtime dependency), but be explicit rather than crashing the build.
  console.warn("[pdfjs] pdfjs-dist not installed; skipping asset sync.");
  process.exit(0);
}

const destination = join(process.cwd(), "public", "pdfjs");

const copies = [
  {
    from: join(packageRoot, "build", "pdf.worker.min.mjs"),
    to: "pdf.worker.min.mjs",
  },
  { from: join(packageRoot, "cmaps"), to: "cmaps" },
  { from: join(packageRoot, "standard_fonts"), to: "standard_fonts" },
  { from: join(packageRoot, "wasm"), to: "wasm" },
];

await mkdir(destination, { recursive: true });

await Promise.all(
  copies.map(async ({ from, to }) => {
    const target = join(destination, to);

    try {
      const [sourceInfo, targetInfo] = await Promise.all([
        stat(from),
        stat(target).catch(() => null),
      ]);

      if (targetInfo && targetInfo.mtimeMs >= sourceInfo.mtimeMs) {
        return;
      }

      await cp(from, target, { force: true, recursive: true });
      console.log(`[pdfjs] synced ${to}`);
    } catch (error) {
      console.warn(`[pdfjs] could not sync ${to}:`, error.message);
    }
  })
);
