import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const BUCKET_NAME = "artifacts";

export type UploadResult = {
  storageKey: string;
  url: string;
  pathname: string;
  contentType: string;
  size: number;
};

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
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folder = chatId ? `${userId}/${chatId}` : `${userId}/general`;
  const storageKey = `${folder}/${Date.now()}-${safeName}`;

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
