import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { saveDocument } from "@/lib/db/queries";
import { activeImageRegistry } from "@/lib/image/session-registry";
import {
  artifactExists,
  createSignedUpload,
  downloadArtifact,
  getArtifactSignedUrl,
  type UploadResult,
  uploadArtifact,
} from "@/lib/storage";
import { ensureArtifactsBucket } from "@/lib/storage/bucket";
import { buildStorageKey, isOwnedStorageKey } from "@/lib/storage/keys";
import {
  ARTIFACTS_BUCKET,
  formatBytes,
  MAX_UPLOAD_BYTES,
  SAFE_MULTIPART_BYTES,
  safeStorageFilename,
  validateUpload,
} from "@/lib/storage/limits";
import { generateUUID } from "@/lib/utils";

const PREVIEW_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Uploads do **not** stream the file through this function.
 *
 * Vercel caps a serverless request body at 4.5 MB and answers
 * `413 FUNCTION_PAYLOAD_TOO_LARGE` before any of our code runs, so proxying the
 * bytes could never carry a phone photo. Instead the browser asks for a signed
 * upload URL (`step: "sign"`), PUTs the bytes straight to Supabase Storage, then
 * reports back (`step: "complete"`) so we can create the Document row and sign a
 * preview URL. Only metadata crosses this function.
 *
 * `multipart/form-data` is still accepted for small files as a compatibility
 * fallback, and is hard-capped below the platform ceiling so it can never be the
 * thing that fails.
 */

const UploadMetaSchema = z.object({
  chatId: z.string().min(1).max(200).optional(),
  contentType: z.string().min(1).max(255),
  filename: z.string().min(1).max(200),
  size: z.number().int().nonnegative(),
});

const JsonRequestSchema = z.discriminatedUnion("step", [
  UploadMetaSchema.extend({ step: z.literal("sign") }),
  UploadMetaSchema.extend({
    step: z.literal("complete"),
    storageKey: z.string().min(1).max(512),
  }),
]);

type PersistImageArgs = {
  base64: string;
  chatId?: string;
  filename: string;
  mimeType: string;
  sourceUrl: string;
  storageKey: string;
  userId: string;
};

/**
 * Turn an uploaded image into a durable, editable artifact.
 *
 * The base64 lives in `document.content` so conversational edits on a later
 * request never depend on expired signed URLs or on in-memory state, and the
 * registry pin lets an edit arrive before the next documents fetch.
 */
async function persistImageArtifact({
  base64,
  chatId,
  filename,
  mimeType,
  sourceUrl,
  storageKey,
  userId,
}: PersistImageArgs): Promise<string | undefined> {
  let documentId: string | undefined;

  try {
    const candidateId = generateUUID();
    await saveDocument({
      content: base64,
      id: candidateId,
      kind: "image",
      title: filename,
      userId,
    });
    documentId = candidateId;
  } catch (error) {
    console.warn(
      "Non-fatal: failed to persist uploaded image document:",
      error
    );
  }

  try {
    activeImageRegistry.setActiveImage({
      base64,
      chatId,
      documentId,
      mimeType,
      sourceUrl,
      storageKey,
      title: filename,
      userId,
    });
  } catch (error) {
    console.warn("Non-fatal: failed to pin image to active registry:", error);
  }

  return documentId;
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return handleMetadataUpload(request, session.user.id);
  }

  return handleProxiedUpload(request, session.user.id);
}

/** `sign` / `complete`: metadata only, no file bytes. */
async function handleMetadataUpload(request: Request, userId: string) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = JsonRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
      },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const validation = validateUpload({
    name: body.filename,
    size: body.size,
    type: body.contentType,
  });

  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.message },
      { status: body.size > MAX_UPLOAD_BYTES ? 413 : 400 }
    );
  }

  // Best effort: a bucket-configuration hiccup must not block an upload the app
  // has already validated, so this is logged rather than fatal.
  await ensureArtifactsBucket().catch((error: unknown) => {
    console.warn("Could not configure artifacts bucket:", error);
  });

  if (body.step === "sign") {
    const storageKey = buildStorageKey({
      chatId: body.chatId,
      filename: body.filename,
      userId,
    });

    try {
      const signed = await createSignedUpload(storageKey);

      return NextResponse.json({
        bucket: ARTIFACTS_BUCKET,
        contentType: body.contentType,
        maxBytes: MAX_UPLOAD_BYTES,
        storageKey,
        token: signed.token,
        uploadUrl: signed.uploadUrl,
      });
    } catch (error) {
      console.error("Signed upload URL error:", error);
      return NextResponse.json(
        { error: "Storage is unavailable right now. Please try again." },
        { status: 502 }
      );
    }
  }

  const { storageKey } = body;

  // The leading user id is the ownership boundary: a caller may only finalise an
  // upload they minted, never someone else's key.
  if (!isOwnedStorageKey(storageKey, userId)) {
    return NextResponse.json(
      { error: "Artifact does not belong to this user." },
      { status: 403 }
    );
  }

  try {
    if (!(await artifactExists(storageKey))) {
      return NextResponse.json(
        { error: "Upload did not reach storage. Please try again." },
        { status: 409 }
      );
    }
  } catch (error) {
    console.error("Artifact existence check failed:", error);
    return NextResponse.json(
      { error: "Storage is unavailable right now. Please try again." },
      { status: 502 }
    );
  }

  const pathname = safeStorageFilename(body.filename);
  let url: string;

  try {
    url = await getArtifactSignedUrl(storageKey, PREVIEW_URL_TTL_SECONDS);
  } catch (error) {
    console.error("Signed preview URL error:", error);
    return NextResponse.json(
      { error: "Storage is unavailable right now. Please try again." },
      { status: 502 }
    );
  }

  const data: UploadResult = {
    contentType: body.contentType,
    pathname,
    size: body.size,
    storageKey,
    url,
  };

  let documentId: string | undefined;

  if (body.contentType.startsWith("image/")) {
    try {
      const buffer = await downloadArtifact(storageKey);
      documentId = await persistImageArtifact({
        base64: buffer.toString("base64"),
        chatId: body.chatId,
        filename: pathname,
        mimeType: body.contentType,
        sourceUrl: url,
        storageKey,
        userId,
      });
    } catch (error) {
      // The bytes are safely in storage and previewable, so a failure to inline
      // them must not turn a successful upload into an error.
      console.warn("Non-fatal: could not inline uploaded image:", error);
    }
  }

  return NextResponse.json({ ...data, documentId });
}

/** Legacy: bytes travel through this function, so keep them under the ceiling. */
async function handleProxiedUpload(request: Request, userId: string) {
  if (request.body === null) {
    return NextResponse.json(
      { error: "Request body is empty" },
      { status: 400 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > SAFE_MULTIPART_BYTES) {
      return NextResponse.json(
        {
          error: `${file.name || "That file"} is ${formatBytes(
            file.size
          )}. Files over ${formatBytes(
            SAFE_MULTIPART_BYTES
          )} must use the direct upload path.`,
        },
        { status: 413 }
      );
    }

    const validation = validateUpload({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }

    const filename = file.name || "upload";
    const mimeType = file.type || "application/octet-stream";
    const fileBuffer = await file.arrayBuffer();
    const chatId = (formData.get("chatId") as string) || undefined;

    let data: UploadResult;

    try {
      data = await uploadArtifact({
        chatId,
        contentType: mimeType,
        fileBuffer,
        filename,
        userId,
      });
    } catch (error) {
      console.error("Storage upload error:", error);
      return NextResponse.json(
        { error: "Upload failed to storage" },
        { status: 500 }
      );
    }

    let documentId: string | undefined;

    if (mimeType.startsWith("image/")) {
      documentId = await persistImageArtifact({
        base64: Buffer.from(fileBuffer).toString("base64"),
        chatId,
        filename,
        mimeType,
        sourceUrl: data.url,
        storageKey: data.storageKey,
        userId,
      });
    }

    return NextResponse.json({ ...data, documentId });
  } catch (error) {
    console.error("Upload request processing error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
