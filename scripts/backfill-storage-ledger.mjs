// biome-ignore-all lint/performance/noAwaitInLoops: one-off backfill is intentionally sequential.
import { AwsClient } from "aws4fetch";
import { config } from "dotenv";
import postgres from "postgres";

config({ override: true, path: ".env.local" });

if (process.env.CONFIRM_STORAGE_BACKFILL !== "yes") {
  console.error(
    "Refusing to write the storage ledger. Re-run with CONFIRM_STORAGE_BACKFILL=yes."
  );
  process.exit(1);
}

const sql = postgres(process.env.POSTGRES_URL, { max: 2, ssl: "require" });
const aws = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  region: "auto",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  service: "s3",
});

const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function mimeFor(key) {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "pdf":
      return "application/pdf";
    case "csv":
      return "text/csv";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function kindFor(contentType, key) {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (/\.(xlsx?|csv)$/i.test(key)) {
    return "sheet";
  }
  if (/\.(pptx?)$/i.test(key)) {
    return "presentation";
  }
  if (/\.(docx?|txt|md)$/i.test(key)) {
    return "document";
  }
  return "other";
}

let token;
const objects = [];

do {
  const url = new URL(base);
  url.searchParams.set("list-type", "2");
  if (token) {
    url.searchParams.set("continuation-token", token);
  }

  const response = await aws.fetch(url.toString());
  if (!response.ok) {
    throw new Error(`R2 list failed with HTTP ${response.status}`);
  }
  const xml = await response.text();

  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const [, block] = match;
    const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1] ?? "");
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0);
    if (key && !key.startsWith("__healthcheck__/")) {
      objects.push({ key, size });
    }
  }

  token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(
    xml
  )?.[1];
} while (token);

console.log("objects", objects.length);

let inserted = 0;
let skipped = 0;

for (const object of objects) {
  const [userId] = object.key.split("/");
  if (!UUID.test(userId)) {
    skipped += 1;
    continue;
  }

  const filename = object.key.split("/").pop() || "object";
  const contentType = mimeFor(object.key);

  const result = await sql`
    insert into "Artifact"
      ("userId", "chatId", "filename", "storageKey", size, "detectedMime", kind, status, "retentionDays", metadata)
    values
      (${userId}, null, ${filename}, ${object.key}, ${String(object.size)}, ${contentType}, ${kindFor(contentType, object.key)}, 'ready', '30', ${sql.json({ source: "r2-backfill" })})
    on conflict ("storageKey") do nothing
  `;

  inserted += result.count;
}

console.log({ inserted, skipped, total: objects.length });
await sql.end();
