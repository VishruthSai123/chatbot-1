/**
 * Generates the app icons from one mark.
 *
 * A rounded square with a speech bubble, in the app's zinc palette. Run with
 * `node scripts/make-icons.mjs`; the output is committed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const OUT = join(process.cwd(), "public", "icons");

function mark(size, padding) {
  const inner = size - padding * 2;

  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#18181b"/>
      <g transform="translate(${padding} ${padding})">
        <rect x="${inner * 0.16}" y="${inner * 0.2}" width="${inner * 0.68}" height="${inner * 0.46}" rx="${inner * 0.14}" fill="#fafafa"/>
        <path d="M ${inner * 0.34} ${inner * 0.62} L ${inner * 0.34} ${inner * 0.78} L ${inner * 0.5} ${inner * 0.66} Z" fill="#fafafa"/>
        <circle cx="${inner * 0.36}" cy="${inner * 0.43}" r="${inner * 0.045}" fill="#18181b"/>
        <circle cx="${inner * 0.5}" cy="${inner * 0.43}" r="${inner * 0.045}" fill="#18181b"/>
        <circle cx="${inner * 0.64}" cy="${inner * 0.43}" r="${inner * 0.045}" fill="#18181b"/>
      </g>
    </svg>`;
}

await mkdir(OUT, { recursive: true });

await Promise.all(
  [192, 512].map(async (size) => {
    const png = await sharp(Buffer.from(mark(size, size * 0.08)))
      .png()
      .toBuffer();

    await writeFile(join(OUT, `icon-${size}.png`), png);
  })
);

// A maskable icon needs its mark inside the safe area, so it gets more padding.
await writeFile(
  join(OUT, "icon-maskable-512.png"),
  await sharp(Buffer.from(mark(512, 512 * 0.2)))
    .png()
    .toBuffer()
);

await writeFile(
  join(OUT, "apple-touch-icon.png"),
  await sharp(Buffer.from(mark(180, 180 * 0.08)))
    .png()
    .toBuffer()
);

console.log("icons written to public/icons");
