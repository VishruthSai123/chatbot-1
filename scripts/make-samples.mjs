/**
 * Generates the sample files the empty state offers.
 *
 * A new user has no PDF, no photo and no recording, so every capability tile
 * dead-ends at "attach a file". These files exist so the first click can
 * actually do something.
 *
 * Run with `node scripts/make-samples.mjs`. The output is committed, so a
 * normal build does not depend on this script.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const OUT = join(process.cwd(), "public", "samples");

async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages = [
    {
      heading: "Quarterly Report",
      lines: [
        "Revenue in the North region reached 142,500 dollars, a rise of eight",
        "percent on the previous quarter. Growth came mostly from renewals.",
        "",
        "Operating costs were 98,000 dollars. Headcount grew by twelve people,",
        "and guidance for the next quarter is unchanged.",
      ],
    },
    {
      heading: "Appendix: Regions",
      lines: [
        "North    142,500",
        "South     88,200",
        "East      61,400",
        "West      37,900",
        "",
        "Figures are unaudited and rounded to the nearest hundred dollars.",
      ],
    },
  ];

  for (const page of pages) {
    const sheet = pdf.addPage([595, 842]);

    sheet.drawText(page.heading, {
      color: rgb(0.1, 0.1, 0.1),
      font: bold,
      size: 22,
      x: 64,
      y: 760,
    });

    let y = 710;

    for (const line of page.lines) {
      if (line) {
        sheet.drawText(line, {
          color: rgb(0.2, 0.2, 0.2),
          font,
          size: 12,
          x: 64,
          y,
        });
      }

      y -= 22;
    }
  }

  await writeFile(join(OUT, "quarterly-report.pdf"), await pdf.save());
}

async function makeImage() {
  // A soft two-colour gradient with a shape, so background removal and
  // cropping both have something to work on.
  const svg = `
    <svg width="900" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1f2937"/>
          <stop offset="100%" stop-color="#9ca3af"/>
        </linearGradient>
      </defs>
      <rect width="900" height="600" fill="url(#g)"/>
      <circle cx="450" cy="300" r="150" fill="#f4f4f5" opacity="0.9"/>
      <rect x="330" y="260" width="240" height="80" rx="40" fill="#18181b"/>
    </svg>`;

  await writeFile(
    join(OUT, "product-photo.png"),
    await sharp(Buffer.from(svg)).png().toBuffer()
  );
}

async function makeCsv() {
  const rows = [
    "region,quarter,revenue,costs,headcount",
    "North,Q1,118000,84000,41",
    "North,Q2,126500,87000,44",
    "North,Q3,134200,91000,48",
    "North,Q4,142500,98000,53",
    "South,Q1,72000,51000,28",
    "South,Q2,76500,53000,29",
    "South,Q3,82100,55000,31",
    "South,Q4,88200,58000,33",
    "East,Q1,54000,39000,19",
    "East,Q2,56100,40000,20",
    "East,Q3,58700,41000,21",
    "East,Q4,61400,43000,22",
    "West,Q1,31000,24000,12",
    "West,Q2,32600,25000,12",
    "West,Q3,35200,26000,13",
    "West,Q4,37900,27000,14",
  ];

  await writeFile(join(OUT, "regional-sales.csv"), `${rows.join("\n")}\n`);
}

async function makeMarkdown() {
  const text = `# Quarterly Report

## Revenue

Revenue in the North region reached **142,500 dollars**, a rise of eight
percent on the previous quarter. Growth came mostly from renewals rather than
new business.

## Costs

Operating costs were **98,000 dollars**. Headcount grew by twelve people, and
guidance for the next quarter is unchanged.

### Notes

- Renewals are up 14 percent year on year
- Churn is flat at 2.1 percent
- The West region remains the smallest and the fastest growing
`;

  await writeFile(join(OUT, "quarterly-report.md"), text);
}

async function makeWav() {
  const sampleRate = 8000;
  const seconds = 4;
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);

  for (let i = 0; i < samples; i += 1) {
    // Two tones with an envelope, so the waveform has shape.
    const t = i / sampleRate;
    const envelope = Math.min(1, t * 2) * Math.min(1, (seconds - t) * 2);
    const value =
      (Math.sin(2 * Math.PI * 220 * t) * 0.5 +
        Math.sin(2 * Math.PI * 440 * t) * 0.25) *
      envelope;

    buffer.writeInt16LE(Math.round(value * 32_767), 44 + i * 2);
  }

  await writeFile(join(OUT, "sample-recording.wav"), buffer);
}

await mkdir(OUT, { recursive: true });
await makePdf();
await makeImage();
await makeCsv();
await makeMarkdown();
await makeWav();

console.log("samples written to public/samples");
