import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { uploadArtifact } from "@/lib/storage";

const ALLOWED_MIME_TYPES = [
  // Images
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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (Supabase Free limit)

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= MAX_FILE_SIZE, {
      message: "File size should be less than 50MB",
    })
    .refine(
      (file) =>
        ALLOWED_MIME_TYPES.includes(file.type) ||
        file.type.startsWith("image/") ||
        file.type.startsWith("text/"),
      {
        message:
          "Unsupported file type. Please upload a supported image, PDF, document, or spreadsheet.",
      }
    ),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.issues
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const fileObj = formData.get("file") as File;
    const filename = fileObj.name || "upload";
    const fileBuffer = await file.arrayBuffer();
    const chatId = (formData.get("chatId") as string) || undefined;

    try {
      const data = await uploadArtifact({
        chatId,
        contentType: file.type || "application/octet-stream",
        fileBuffer,
        filename,
        userId: session.user.id,
      });

      return NextResponse.json(data);
    } catch (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return NextResponse.json(
        { error: "Upload failed to storage" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Upload request processing error:", err);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
