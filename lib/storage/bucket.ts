import "server-only";

import { supabaseAdmin } from "@/lib/storage";
import {
  ARTIFACTS_BUCKET,
  MAX_UPLOAD_BYTES,
  STORAGE_ALLOWED_MIME_TYPES,
} from "@/lib/storage/limits";

/**
 * Makes the storage bucket match the limits the app enforces.
 *
 * A bucket that exists but carries its own (or inherited) size/MIME settings is
 * how "the UI says 16 MB" and "storage says 8 MB" drift apart. Configuring it
 * from the same constants removes that class of failure, and doing it lazily
 * means a fresh environment needs no manual Supabase dashboard step.
 *
 * The result is memoised per server instance; failures clear the memo so the
 * next upload retries instead of being poisoned by one transient error.
 */
let ensured: Promise<void> | null = null;

export function ensureArtifactsBucket(): Promise<void> {
  ensured ??= configureBucket().catch((error: unknown) => {
    ensured = null;
    throw error;
  });

  return ensured;
}

async function configureBucket(): Promise<void> {
  const { data: buckets, error: listError } =
    await supabaseAdmin.storage.listBuckets();

  if (listError) {
    throw new Error(`Could not read storage buckets: ${listError.message}`);
  }

  const options = {
    allowedMimeTypes: [...STORAGE_ALLOWED_MIME_TYPES],
    fileSizeLimit: MAX_UPLOAD_BYTES,
    public: false,
  };

  const existing = buckets?.find((bucket) => bucket.name === ARTIFACTS_BUCKET);

  if (!existing) {
    const { error } = await supabaseAdmin.storage.createBucket(
      ARTIFACTS_BUCKET,
      options
    );
    if (error) {
      throw new Error(
        `Could not create bucket ${ARTIFACTS_BUCKET}: ${error.message}`
      );
    }
    return;
  }

  // `public: false` keeps artifacts private; downloads always go through a
  // short-lived signed URL.
  const { error } = await supabaseAdmin.storage.updateBucket(
    ARTIFACTS_BUCKET,
    options
  );
  if (error) {
    throw new Error(
      `Could not configure bucket ${ARTIFACTS_BUCKET}: ${error.message}`
    );
  }
}
