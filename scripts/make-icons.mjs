/**
 * Generates the web app icons from the Spire master mark.
 *
 * The mark is a stroked path, so one source file can produce a crisp icon at
 * every size. Run with `node scripts/make-icons.mjs`; the output is committed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const OUT = join(process.cwd(), "public", "icons");
const PATH = await readFile(
  join(process.cwd(), "artifacts", "spire", "spire-mark-path.txt"),
  "utf8"
);

const VIEW = { h: 582, stroke: 73, w: 742, x: 8.5, y: 9.5 };

function icon(size, markFraction, { rounded = true } = {}) {
  const scale = (size * markFraction) / VIEW.w;
  const tx = (size - VIEW.w * scale) / 2 - VIEW.x * scale;
  const ty = (size - VIEW.h * scale) / 2 - VIEW.y * scale;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${rounded ? size * 0.225 : 0}" fill="#09090B"/>
      <g transform="translate(${tx} ${ty}) scale(${scale})">
        <path d="${PATH}" fill="none" stroke="#A9A9A9" stroke-width="${VIEW.stroke}"
          stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>`;
}

await mkdir(OUT, { recursive: true });

await Promise.all(
  [192, 512].map(async (size) => {
    const png = await sharp(Buffer.from(icon(size, 0.62)))
      .png()
      .toBuffer();
    await writeFile(join(OUT, `icon-${size}.png`), png);
  })
);

await writeFile(
  join(OUT, "icon-maskable-512.png"),
  await sharp(Buffer.from(icon(512, 0.58, { rounded: false })))
    .png()
    .toBuffer()
);

await writeFile(
  join(OUT, "apple-touch-icon.png"),
  await sharp(Buffer.from(icon(180, 0.62)))
    .png()
    .toBuffer()
);

console.log("icons written to public/icons");
