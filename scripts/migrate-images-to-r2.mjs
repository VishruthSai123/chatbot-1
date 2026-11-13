import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { config } from "dotenv";
import postgres from "postgres";
import sharp from "sharp";

config({ override: true, path: ".env.local" });

if (process.env.CONFIRM_R2_MIGRATION !== "yes") {
  console.error(
    "Refusing to rewrite image documents. Re-run with CONFIRM_R2_MIGRATION=yes."
  );
  process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const connectionString = process.env.POSTGRES_URL;

if (
  !(accountId && bucket && accessKeyId && secretAccessKey && connectionString)
) {
  console.error("Missing R2 or POSTGRES_URL environment variables.");
  process.exit(1);
}

const aws = new AwsClient({
  accessKeyId,
  region: "auto",
  secretAccessKey,
  service: "s3",
});

const sql = postgres(connectionString, { max: 2, ssl: "require" });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(
  process.env.USERPROFILE ?? ".",
  "OneDrive",
  "Desktop",
  "Spire-backups"
);
const backupPath = path.join(backupDir, `image-documents-${timestamp}.json`);

function mimeFor(format) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function extensionFor(format) {
  if (format === "jpeg" || format === "jpg") {
    return "jpg";
  }
  if (format === "png") {
    return "png";
  }
  if (format === "webp") {
    return "webp";
  }
  if (format === "gif") {
    return "gif";
  }
  if (format === "avif") {
    return "avif";
  }
  return "bin";
}

function decodeContent(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    const meta = trimmed.slice(5, comma);
    const format = meta.split(";")[0]?.split("/")[1] ?? "bin";
    return { buffer: Buffer.from(trimmed.slice(comma + 1), "base64"), format };
  }
  return { buffer: Buffer.from(trimmed, "base64"), format: null };
}

function objectUrl(storageKey) {
  const encoded = storageKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encoded}`;
}

function isMigrated(content) {
  return (
    content.startsWith("image-ref:") || content.startsWith("image-collection:")
  );
}

async function main() {
  console.log("Reading image documents...");
  const rows = await sql`
    select ctid::text as ctid, id, "createdAt", "userId", title, content
    from "Document"
    where "text" = 'image' and content is not null
    order by "createdAt" asc
  `;
  console.log("image rows", rows.length);

  const pending = rows.filter((row) => !isMigrated(row.content));
  console.log("pending base64 rows", pending.length);

  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, JSON.stringify(rows, null, 2), "utf8");
  console.log("backup", backupPath);

  let migrated = 0;
  let failed = 0;

  for (const [index, row] of pending.entries()) {
    const label = `${index + 1}/${pending.length} ${row.id}`;
    try {
      const { buffer, format: dataFormat } = decodeContent(row.content);
      // biome-ignore lint/performance/noAwaitInLoops: migration is intentionally sequential.
      const metadata = await sharp(buffer).metadata();
      const format = metadata.format ?? dataFormat ?? "bin";
      const ext = extensionFor(format);
      const createdMs = new Date(row.createdAt).getTime();
      const storageKey = `${row.userId}/general/migrated-${row.id}-${createdMs}.${ext}`;

      const upload = await aws.fetch(objectUrl(storageKey), {
        body: buffer,
        headers: { "content-type": mimeFor(format) },
        method: "PUT",
      });

      if (!upload.ok) {
        throw new Error(`R2 upload ${upload.status}`);
      }

      const ref = {
        filename: `${row.title || "image"}.${ext}`,
        format,
        height: metadata.height,
        sizeBytes: buffer.length,
        storageKey,
        width: metadata.width,
      };

      const updated = await sql`
        update "Document"
        set content = ${`image-ref:${JSON.stringify(ref)}`}
        where ctid = ${row.ctid}::tid
      `;

      if (updated.count !== 1) {
        throw new Error(`updated ${updated.count} rows`);
      }

      migrated += 1;
      if (migrated % 10 === 0 || migrated === pending.length) {
        console.log(`${label} migrated (${migrated})`);
      }
    } catch (error) {
      failed += 1;
      console.error(`${label} failed:`, error.message);
    }
  }

  const [{ remaining }] = await sql`
    select count(*)::int as remaining
    from "Document"
    where "text" = 'image'
      and content is not null
      and content not like 'image-ref:%'
  `;

  const [{ refs }] = await sql`
    select count(*)::int as refs
    from "Document"
    where "text" = 'image' and content like 'image-ref:%'
  `;

  console.log({ failed, migrated, refs, remaining });
  console.log("backup", backupPath);
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
