import "server-only";

import { AwsClient } from "aws4fetch";
import type { SignedUpload, UploadResult } from "@/lib/storage";
import { buildStorageKey } from "@/lib/storage/keys";
import { ARTIFACTS_BUCKET, safeStorageFilename } from "@/lib/storage/limits";

const DEFAULT_EXPIRY_SECONDS = 60 * 60;

let _client: AwsClient | null = null;

function getClient(): AwsClient {
  if (_client) {
    return _client;
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!(accessKeyId && secretAccessKey)) {
    throw new Error(
      "R2 is selected but R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are missing."
    );
  }

  _client = new AwsClient({
    accessKeyId,
    region: "auto",
    secretAccessKey,
    service: "s3",
  });

  return _client;
}

function bucketName(): string {
  return process.env.R2_BUCKET?.trim() || ARTIFACTS_BUCKET;
}

function objectUrl(storageKey: string): string {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID is missing.");
  }

  const encodedKey = storageKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `https://${accountId}.r2.cloudflarestorage.com/${bucketName()}/${encodedKey}`;
}

async function presign(
  storageKey: string,
  method: "GET" | "HEAD" | "PUT" | "DELETE",
  expiresInSeconds = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  const url = new URL(objectUrl(storageKey));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  const signed = await getClient().sign(url.toString(), {
    aws: { signQuery: true },
    method,
  });

  return signed.url.toString();
}

export async function r2CreateSignedUpload(
  storageKey: string
): Promise<SignedUpload> {
  return {
    token: "r2",
    uploadUrl: await presign(storageKey, "PUT", 15 * 60),
  };
}

export async function r2ArtifactExists(storageKey: string): Promise<boolean> {
  const response = await fetch(await presign(storageKey, "HEAD", 300), {
    method: "HEAD",
  });
  return response.ok;
}

/** Actual stored size, so a client cannot under-report an upload. */
export async function r2ArtifactSize(
  storageKey: string
): Promise<number | null> {
  const response = await fetch(await presign(storageKey, "HEAD", 300), {
    method: "HEAD",
  });

  if (!response.ok) {
    return null;
  }

  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) && length >= 0 ? length : null;
}

export async function r2UploadArtifact(input: {
  chatId?: string;
  contentType: string;
  fileBuffer: ArrayBuffer | Buffer;
  filename: string;
  userId: string;
}): Promise<UploadResult> {
  const safeName = safeStorageFilename(input.filename);
  const storageKey = buildStorageKey({
    chatId: input.chatId,
    filename: input.filename,
    userId: input.userId,
  });

  const byteLength =
    input.fileBuffer instanceof Buffer
      ? input.fileBuffer.length
      : input.fileBuffer.byteLength;

  const response = await getClient().fetch(objectUrl(storageKey), {
    body: input.fileBuffer,
    headers: {
      "content-length": String(byteLength),
      "content-type": input.contentType,
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed with HTTP ${response.status}.`);
  }

  return {
    contentType: input.contentType,
    pathname: safeName,
    size: byteLength,
    storageKey,
    url: await r2GetArtifactSignedUrl(storageKey, 7 * 24 * 60 * 60),
  };
}

export async function r2GetArtifactSignedUrl(
  storageKey: string,
  expiresInSeconds = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  return await presign(storageKey, "GET", expiresInSeconds);
}

export async function r2DownloadArtifact(storageKey: string): Promise<Buffer> {
  const response = await fetch(await presign(storageKey, "GET"));

  if (!response.ok) {
    throw new Error(`R2 download failed with HTTP ${response.status}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function r2DeleteArtifact(storageKey: string): Promise<void> {
  const response = await fetch(await presign(storageKey, "DELETE"), {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed with HTTP ${response.status}.`);
  }
}
