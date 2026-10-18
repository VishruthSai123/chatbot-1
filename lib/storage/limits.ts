/**
 * Upload limits shared by the browser, the API routes and the Supabase bucket.
 *
 * These live in one module on purpose: a file that passes the client check must
 * not be rejected later by a *different* limit somewhere else in the stack. That
 * mismatch is what produced opaque 413s — the UI advertised a size the transport
 * could never carry.
 *
 * This module is imported by client components, so it must stay free of
 * `server-only` dependencies.
 */

export const ARTIFACTS_BUCKET = "artifacts";

/**
 * Bytes per file, enforced in the browser, in the API and on the bucket.
 *
 * Kept well under Supabase's per-file ceiling while comfortably covering phone
 * photos and scanned documents. Images are additionally persisted inline in
 * Postgres (see `document.content`), so an unbounded limit would let a handful
 * of uploads bloat the database — a single edit copies the whole byte count
 * again as a new version.
 */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/**
 * Vercel rejects any serverless request body over 4.5 MB with
 * `FUNCTION_PAYLOAD_TOO_LARGE` *before* the function runs, so a proxied upload
 * cannot work above this. `SAFE_MULTIPART_BYTES` leaves headroom for multipart
 * framing (boundaries, headers, the extra `chatId` field) so the fallback path
 * only ever carries files it can actually deliver.
 */
export const SERVERLESS_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;
export const SAFE_MULTIPART_BYTES = 4 * 1024 * 1024;

/**
 * Longest base64 payload that may ride inside a JSON request body (the legacy
 * inline-image contract). Base64 is ASCII, so characters and bytes line up
 * closely; the margin absorbs the rest of the JSON envelope.
 */
export const MAX_INLINE_BASE64_CHARS = Math.floor(
  SERVERLESS_BODY_LIMIT_BYTES * 0.9
);

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  // Documents & PDFs
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Spreadsheets
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  // Presentations
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Audio & Video
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // Generic fallback for binary files with valid extensions
  "application/octet-stream",
];

/**
 * What to configure on the storage bucket.
 *
 * `isAllowedUploadType` deliberately accepts *any* `image/*` or `text/*`, so the
 * bucket has to allow the same wildcards — Supabase Storage supports them. Without
 * these entries the app would happily accept a HEIC photo and storage would answer
 * `415 invalid_mime_type`, which is precisely the kind of split-brain limit this
 * module exists to prevent.
 */
export const STORAGE_ALLOWED_MIME_TYPES = [
  ...ALLOWED_UPLOAD_MIME_TYPES,
  "image/*",
  "text/*",
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function isAllowedUploadType(type: string): boolean {
  if (!type) {
    // Some browsers report an empty type for unusual but valid files; the
    // extension still gets validated against the allowlist server-side.
    return true;
  }
  return (
    ALLOWED_UPLOAD_MIME_TYPES.includes(type) ||
    type.startsWith("image/") ||
    type.startsWith("text/")
  );
}

export type UploadCandidate = {
  name?: string;
  size: number;
  type: string;
};

export type UploadValidation = { ok: true } | { message: string; ok: false };

/**
 * Single source of truth for "may this file be uploaded", used by the picker
 * (for instant feedback), the signed-upload route and the fallback proxy.
 */
export function validateUpload(candidate: UploadCandidate): UploadValidation {
  const label = candidate.name?.trim() || "That file";

  if (candidate.size <= 0) {
    return { message: `${label} is empty.`, ok: false };
  }

  if (candidate.size > MAX_UPLOAD_BYTES) {
    return {
      message: `${label} is ${formatBytes(
        candidate.size
      )}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} per file.`,
      ok: false,
    };
  }

  if (!isAllowedUploadType(candidate.type)) {
    return {
      message: `${label} is not a supported file type.`,
      ok: false,
    };
  }

  return { ok: true };
}

/** Filenames are embedded in storage keys, so strip anything path-like. */
export function safeStorageFilename(filename: string): string {
  const cleaned = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 120);
  return cleaned || "upload";
}
