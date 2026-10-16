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
  id: z.uuid(),
  message: userMessageSchema.optional(),
  messages: z.array(toolApprovalMessageSchema).optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
