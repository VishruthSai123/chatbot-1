import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildStorageKey } from "@/lib/storage/keys";
import { ARTIFACTS_BUCKET, safeStorageFilename } from "@/lib/storage/limits";

let _supabaseAdmin: SupabaseClient | null = null;

export function getStorageClient(): SupabaseClient {
  if (_supabaseAdmin) {
    return _supabaseAdmin;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables."
    );
  }

  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _supabaseAdmin;
}

// Backwards-compatible proxy export so existing callers can use supabaseAdmin directly
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getStorageClient();
    return (client as unknown as Record<string, unknown>)[prop as string];
  },
});

export const BUCKET_NAME = ARTIFACTS_BUCKET;

export type UploadResult = {
  storageKey: string;
  url: string;
  pathname: string;
  contentType: string;
  size: number;
};

export type SignedUpload = {
  token: string;
  uploadUrl: string;
};

/**
 * Mint a short-lived URL the *browser* can PUT the bytes to, so the file never
 * travels through the serverless function (and therefore never hits the 4.5 MB
 * request-body ceiling that caused `FUNCTION_PAYLOAD_TOO_LARGE`).
 */
export async function createSignedUpload(
  storageKey: string
): Promise<SignedUpload> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUploadUrl(storageKey, { upsert: false });

  if (error || !data?.signedUrl || !data.token) {
    throw new Error(
      `Failed to create signed upload URL: ${error?.message ?? "no URL returned"}`
    );
  }

  return { token: data.token, uploadUrl: data.signedUrl };
}

export async function artifactExists(storageKey: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .exists(storageKey);

  return Boolean(data) && !error;
}

/**
 * Upload an artifact buffer or stream to private Supabase Storage
 */
export async function uploadArtifact({
  fileBuffer,
  filename,
  contentType,
  userId,
  chatId,
}: {
  fileBuffer: ArrayBuffer | Buffer;
  filename: string;
  contentType: string;
  userId: string;
  chatId?: string;
}): Promise<UploadResult> {
  const safeName = safeStorageFilename(filename);
  const storageKey = buildStorageKey({ chatId, filename, userId });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(storageKey, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    console.error("Supabase storage upload error:", error);
    throw new Error(`Failed to upload to storage: ${error.message}`);
  }

  // Create a signed URL valid for 7 days (604,800 seconds) for in-app preview
  const { data: signedData, error: signError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storageKey, 60 * 60 * 24 * 7);

  if (signError || !signedData?.signedUrl) {
    throw new Error("Failed to generate signed URL for uploaded artifact");
  }

  const byteLength =
    fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength;

  return {
    contentType,
    pathname: safeName,
    size: byteLength,
    storageKey,
    url: signedData.signedUrl,
  };
}

/**
 * Generate a short-lived signed URL for downloading or previewing an artifact
 */
export async function getArtifactSignedUrl(
  storageKey: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Download an artifact as a Buffer for backend processing (PDF, Image, CSV transforms)
 */
export async function downloadArtifact(storageKey: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .download(storageKey);

  if (error || !data) {
    throw new Error(`Failed to download artifact: ${error?.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete an artifact from storage
 */
export async function deleteArtifact(storageKey: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([storageKey]);

  if (error) {
    console.error("Failed to delete artifact from storage:", error);
    throw new Error(`Failed to delete artifact: ${error.message}`);
  }
}
