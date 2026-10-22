import { z } from "zod";

const textPartSchema = z.object({
  text: z.string().max(10_000).default(""),
  type: z.literal("text"),
});

const filePartSchema = z.object({
  // Durable Postgres Document id for uploaded images. Must be preserved through
  // validation (zod strips unknown keys) so image tools can resolve bytes from the
  // database instead of relying on expiring signed URLs.
  documentId: z.uuid().optional(),
  // The name the user sees on the attachment. The AI SDK copies this into the
  // provider message, so it is how the model learns what a file is called —
  // without it the model sees an anonymous file and cannot name it.
  filename: z.string().max(255).optional(),
  mediaType: z.string(),
  name: z.string().optional(),
  type: z.literal("file"),
  url: z.string(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.uuid(),
  parts: z.array(partSchema),
  role: z.enum(["user"]),
});

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  parts: z.array(z.record(z.string(), z.unknown())),
  role: z.enum(["user", "assistant"]),
});

export const postRequestBodySchema = z.object({
  // The image currently open in the right-pane workbench. Lets image tools operate
  // on exactly that Document instead of re-deriving it from fragile URLs.
  activeImage: z
    .object({
      documentId: z.string().optional(),
      toolMode: z.string().optional(),
      versionIndex: z.number().int().min(0).optional(),
    })
    .optional(),
  // The PDF currently open in the right-pane studio. Lets PDF tools operate
  // on exactly that Document instead of hunting for attachments.
  activePdf: z
    .object({
      documentId: z.string().optional(),
      versionIndex: z.number().int().min(0).optional(),
    })
    .optional(),
  // The spreadsheet currently open in the Data Studio. Lets data tools operate
  // on exactly that Document instead of hunting for attachments.
  activeSheet: z
    .object({
      documentId: z.string().optional(),
      versionIndex: z.number().int().min(0).optional(),
    })
    .optional(),
  id: z.uuid(),
  message: userMessageSchema.optional(),
  messages: z.array(toolApprovalMessageSchema).optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
