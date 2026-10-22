import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { type AudioRef, encodeAudioRef, isAudioUpload } from "@/lib/audio/ref";
import { saveDocument } from "@/lib/db/queries";
import { parseDocument } from "@/lib/doc/native";
import { encodeDocRef } from "@/lib/doc/ref";
import { activeImageRegistry } from "@/lib/image/session-registry";
import { encodePdfRef } from "@/lib/pdf/ref";
import { encodeSheetRef } from "@/lib/sheet/ref";
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

type PersistPdfArgs = {
  chatId?: string;
  filename: string;
  pageCount?: number;
  size: number;
  storageKey: string;
  userId: string;
};

/**
 * Turns an uploaded PDF into an editable artifact.
 *
 * Unlike images, the bytes stay in storage and `Document.content` holds only a
 * `pdf-ref:` envelope. A scanned document is routinely 10–30 MB; inlining it would
 * put a base64 copy in Postgres for every version and would exceed the request-body
 * ceiling on the first edit.
 */
async function persistPdfArtifact({
  chatId: _chatId,
  filename,
  pageCount,
  size,
  storageKey,
  userId,
}: PersistPdfArgs): Promise<string | undefined> {
  try {
    const saved = await saveDocument({
      content: encodePdfRef({
        bytes: size,
        filename,
        pages: pageCount,
        storageKey,
      }),
      id: generateUUID(),
      kind: "pdf",
      title: filename,
      userId,
    });

    return saved?.[0]?.id;
  } catch (error) {
    // The file is already in storage and downloadable; failing to index it must
    // not turn a successful upload into an error.
    console.warn("Non-fatal: failed to persist uploaded PDF document:", error);
  }
}

/**
 * Turns an uploaded spreadsheet into an editable artifact.
 *
 * Same reasoning as the PDF: the bytes stay in storage and `Document.content`
 * holds a `sheet-ref:` envelope. A 50,000-row CSV is megabytes of text, and
 * every operation would otherwise copy the whole file into Postgres again.
 */
async function persistSheetArtifact({
  chatId: _chatId,
  filename,
  size,
  storageKey,
  userId,
}: {
  chatId?: string;
  filename: string;
  size: number;
  storageKey: string;
  userId: string;
}): Promise<string | undefined> {
  try {
    const saved = await saveDocument({
      content: encodeSheetRef({
        filename,
        format: detectSheetFormat(filename),
        sizeBytes: size,
        storageKey,
      }),
      id: generateUUID(),
      kind: "sheet",
      title: filename,
      userId,
    });

    return saved?.[0]?.id;
  } catch (error) {
    // The file is already in storage and downloadable; failing to index it must
    // not turn a successful upload into an error.
    console.warn(
      "Non-fatal: failed to persist uploaded sheet document:",
      error
    );
  }
}

/**
 * Turns an uploaded document into an artifact.
 *
 * The text is extracted here so the studio can open immediately, and it is
 * capped: a very long document would otherwise make the document row enormous,
 * and the tools re-extract the text from the file when they need the whole of
 * it. The cap is generous — a 200,000-character document is roughly 35,000
 * words, which is already a full book.
 */
async function persistDocArtifact({
  chatId: _chatId,
  filename,
  size: _size,
  storageKey,
  userId,
}: {
  chatId?: string;
  filename: string;
  size: number;
  storageKey: string;
  userId: string;
}): Promise<string | undefined> {
  try {
    const buffer = await downloadArtifact(storageKey);
    const parsed = await parseDocument({ buffer, filename });

    const saved = await saveDocument({
      content: encodeDocRef({
        filename,
        format: parsed.format,
        outline: parsed.outline,
        stats: parsed.stats,
        storageKey,
        text: parsed.text.slice(0, 200_000),
        title: filename,
      }),
      id: generateUUID(),
      kind: "doc",
      title: filename,
      userId,
    });

    return saved?.[0]?.id;
  } catch (error) {
    // The file is already in storage and downloadable; failing to index it must
    // not turn a successful upload into an error.
    console.warn("Non-fatal: failed to persist uploaded document:", error);
  }
}

/**
 * Turns an uploaded recording into an artifact.
 *
 * The media stays in storage and `Document.content` holds an `audio-ref:`
 * descriptor. A recording is the largest file this app stores — a lecture is
 * tens of megabytes — so keeping it out of Postgres is not a nicety.
 */
async function persistAudioArtifact({
  chatId: _chatId,
  filename,
  size: _size,
  storageKey,
  userId,
}: {
  chatId?: string;
  filename: string;
  size: number;
  storageKey: string;
  userId: string;
}): Promise<string | undefined> {
  try {
    const ref: AudioRef = { filename, storageKey };
    const saved = await saveDocument({
      content: encodeAudioRef(ref),
      id: generateUUID(),
      kind: "audio",
      title: filename,
      userId,
    });

    return saved?.[0]?.id;
  } catch (error) {
    // The file is already in storage and downloadable; failing to index it must
    // not turn a successful upload into an error.
    console.warn(
      "Non-fatal: failed to persist uploaded audio document:",
      error
    );
  }
}
/** Infers the sheet format from a filename. */
function detectSheetFormat(filename: string): "csv" | "tsv" | "xlsx" {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return "xlsx";
  }

  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    return "tsv";
  }

  return "csv";
}

/**
 * Extensions this family can actually read.
 *
 * The legacy `.xls` binary format is deliberately absent: `exceljs` only reads
 * the OOXML format, so indexing an `.xls` would produce a studio that fails to
 * open rather than one that works.
 */
const SHEET_EXTENSIONS = [".csv", ".tsv", ".tab", ".xlsx", ".xlsm"];

const SHEET_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/**
 * Decides whether an upload should become a spreadsheet.
 *
 * The extension is trusted over the MIME type because browsers routinely report
 * a spreadsheet as `application/octet-stream`, while the filename is never
 * wrong about the format the user actually chose.
 */
function isSheetUpload(contentType: string, filename: string): boolean {
  const lower = filename.toLowerCase();

  if (SHEET_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return true;
  }

  return SHEET_MIME_TYPES.includes(contentType);
}

/** Extensions the Document Studio can open. */
const DOC_EXTENSIONS = [".docx", ".md", ".markdown", ".txt", ".text"];

const DOC_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
];

/**
 * Decides whether an upload should become a document.
 *
 * The extension is trusted over the MIME type, for the same reason as the
 * spreadsheet check: browsers routinely report a document as
 * `application/octet-stream`, while the filename is never wrong.
 */
function isDocUpload(contentType: string, filename: string): boolean {
  const lower = filename.toLowerCase();

  if (DOC_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return true;
  }

  return DOC_MIME_TYPES.includes(contentType);
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
  } else if (body.contentType === "application/pdf") {
    documentId = await persistPdfArtifact({
      chatId: body.chatId,
      filename: pathname,
      size: body.size,
      storageKey,
      userId,
    });
  } else if (isSheetUpload(body.contentType, pathname)) {
    documentId = await persistSheetArtifact({
      chatId: body.chatId,
      filename: pathname,
      size: body.size,
      storageKey,
      userId,
    });
  } else if (isDocUpload(body.contentType, pathname)) {
    documentId = await persistDocArtifact({
      chatId: body.chatId,
      filename: pathname,
      size: body.size,
      storageKey,
      userId,
    });
  } else if (isAudioUpload(body.contentType, pathname)) {
    documentId = await persistAudioArtifact({
      chatId: body.chatId,
      filename: pathname,
      size: body.size,
      storageKey,
      userId,
    });
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
    } else if (mimeType === "application/pdf") {
      documentId = await persistPdfArtifact({
        chatId,
        filename,
        size: fileBuffer.byteLength,
        storageKey: data.storageKey,
        userId,
      });
    } else if (isSheetUpload(mimeType, filename)) {
      documentId = await persistSheetArtifact({
        chatId,
        filename,
        size: fileBuffer.byteLength,
        storageKey: data.storageKey,
        userId,
      });
    } else if (isDocUpload(mimeType, filename)) {
      documentId = await persistDocArtifact({
        chatId,
        filename,
        size: fileBuffer.byteLength,
        storageKey: data.storageKey,
        userId,
      });
    } else if (isAudioUpload(mimeType, filename)) {
      documentId = await persistAudioArtifact({
        chatId,
        filename,
        size: fileBuffer.byteLength,
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
