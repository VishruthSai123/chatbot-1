import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  SAFE_MULTIPART_BYTES,
  validateUpload,
} from "@/lib/storage/limits";

/**
 * Uploads go browser → Supabase Storage directly, not through a serverless
 * function.
 *
 * Vercel answers `413 FUNCTION_PAYLOAD_TOO_LARGE` for any request body over
 * 4.5 MB *before* the function runs, which is why proxying a phone photo could
 * never work. The flow is:
 *
 *   1. `step: "sign"`   → the API returns a short-lived signed upload URL
 *   2. `PUT` the bytes  → straight to storage, no platform body limit
 *   3. `step: "complete"` → the API verifies the object and creates the Document
 *
 * Small files keep a proxied fallback so a signing hiccup can never make the
 * previously working path regress.
 */

export type UploadedFile = {
  contentType: string;
  documentId?: string;
  name: string;
  url: string;
};

export class UploadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "UploadError";
    this.status = status;
  }
}

const API_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`;

/** Statuses that mean "this deployment cannot place the bytes", not "your file is bad". */
const FALLBACK_STATUSES = new Set([404, 405, 500, 501, 502, 503]);

type UploadOptions = {
  chatId?: string;
};

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const raw = await response.text().catch(() => "");
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error;
      }
    } catch {
      // Fall through to the raw text below.
    }
  }

  if (response.status === 413) {
    return `That file is larger than the server accepts. The limit is ${formatBytes(
      MAX_UPLOAD_BYTES
    )}.`;
  }

  if (trimmed) {
    return trimmed.slice(0, 240);
  }

  return fallback;
}

function baseMetadata(file: File, chatId?: string) {
  return {
    chatId,
    contentType: file.type || "application/octet-stream",
    filename: file.name || "upload",
    size: file.size,
  };
}

/** Direct path: sign → PUT to storage → complete. */
async function uploadDirect(
  file: File,
  chatId?: string
): Promise<UploadedFile> {
  const signResponse = await fetch(API_PATH, {
    body: JSON.stringify({ ...baseMetadata(file, chatId), step: "sign" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!signResponse.ok) {
    throw new UploadError(
      await readErrorMessage(signResponse, "Could not prepare the upload."),
      signResponse.status
    );
  }

  const signed = (await signResponse.json()) as {
    storageKey?: string;
    uploadUrl?: string;
  };

  if (!(signed.uploadUrl && signed.storageKey)) {
    throw new UploadError("Could not prepare the upload.", signResponse.status);
  }

  const { storageKey, uploadUrl } = signed;

  let putResponse: Response | null = null;
  let unreachableCause: unknown = null;

  try {
    putResponse = await fetch(uploadUrl, {
      body: file,
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      method: "PUT",
    });
  } catch (cause) {
    // A blocked direct hop (CORS/network) is recorded, not thrown: a proxied
    // retry can still carry files the serverless transport is able to handle.
    unreachableCause = cause;
  }

  if (!putResponse) {
    throw new UploadError(
      "Could not reach storage from this browser.",
      undefined,
      { cause: unreachableCause }
    );
  }

  if (!putResponse.ok) {
    throw new UploadError(
      `Storage rejected the upload (HTTP ${putResponse.status}).`,
      putResponse.status
    );
  }

  const completeResponse = await fetch(API_PATH, {
    body: JSON.stringify({
      ...baseMetadata(file, chatId),
      step: "complete",
      storageKey,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!completeResponse.ok) {
    throw new UploadError(
      await readErrorMessage(completeResponse, "Could not finish the upload."),
      completeResponse.status
    );
  }

  const data = (await completeResponse.json()) as {
    contentType?: string;
    documentId?: string;
    pathname?: string;
    url?: string;
  };

  return {
    contentType: data.contentType ?? file.type,
    documentId: data.documentId,
    name: data.pathname ?? file.name,
    url: data.url ?? "",
  };
}

/** Compatibility path for small files: the bytes ride along with the request. */
async function uploadProxied(
  file: File,
  chatId?: string
): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append("file", file);
  if (chatId) {
    formData.append("chatId", chatId);
  }

  const response = await fetch(API_PATH, { body: formData, method: "POST" });

  if (!response.ok) {
    throw new UploadError(
      await readErrorMessage(response, "Upload failed"),
      response.status
    );
  }

  const data = (await response.json()) as {
    contentType?: string;
    documentId?: string;
    pathname?: string;
    url?: string;
  };

  return {
    contentType: data.contentType ?? file.type,
    documentId: data.documentId,
    name: data.pathname ?? file.name,
    url: data.url ?? "",
  };
}

export async function uploadFile(
  file: File,
  options: UploadOptions = {}
): Promise<UploadedFile> {
  const validation = validateUpload({
    name: file.name,
    size: file.size,
    type: file.type,
  });

  if (!validation.ok) {
    throw new UploadError(validation.message, 400);
  }

  try {
    return await uploadDirect(file, options.chatId);
  } catch (error) {
    // Only a "we could not place the bytes" failure is worth retrying through the
    // proxy, and only when the file is small enough for that transport. A refused
    // file, or one too big for the proxy, must surface its real reason.
    const canFallBack =
      error instanceof UploadError &&
      file.size <= SAFE_MULTIPART_BYTES &&
      (error.status === undefined || FALLBACK_STATUSES.has(error.status));

    if (!canFallBack) {
      throw error;
    }

    return await uploadProxied(file, options.chatId);
  }
}
