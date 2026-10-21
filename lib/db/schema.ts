import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  attachments: json("attachments").notNull(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  parts: json("parts").notNull(),
  role: varchar("role").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    isUpvoted: boolean("isUpvoted").notNull(),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    content: text("content"),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    kind: varchar("text", {
      enum: ["text", "code", "image", "sheet", "pdf", "notebook"],
    })
      .notNull()
      .default("text"),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    documentId: uuid("documentId").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    isResolved: boolean("isResolved").notNull().default(false),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
  },
  (table) => ({
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

// --- PRD Universal AI Workbench Entities ---

export const task = pgTable("Task", {
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: text("errorMessage"),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }),
  plan: json("plan"),
  request: text("request").notNull(),
  status: varchar("status", {
    enum: [
      "queued",
      "planning",
      "waiting_for_user",
      "running",
      "retrying",
      "partially_succeeded",
      "succeeded",
      "failed",
      "cancelled",
    ],
  })
    .notNull()
    .default("queued"),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type Task = InferSelectModel<typeof task>;

export const taskStep = pgTable("TaskStep", {
  attempts: varchar("attempts", { length: 8 }).notNull().default("0"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  dependencies: json("dependencies"),
  error: text("error"),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  inputReferences: json("inputReferences"),
  outputReferences: json("outputReferences"),
  status: varchar("status", {
    enum: ["pending", "running", "succeeded", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  stepKey: varchar("stepKey", { length: 64 }).notNull(),
  taskId: uuid("taskId")
    .notNull()
    .references(() => task.id),
  toolId: varchar("toolId", { length: 64 }).notNull(),
  toolVersion: varchar("toolVersion", { length: 32 })
    .notNull()
    .default("1.0.0"),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type TaskStep = InferSelectModel<typeof taskStep>;

export const artifact = pgTable("Artifact", {
  chatId: uuid("chatId").references(() => chat.id),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  detectedMime: varchar("detectedMime", { length: 128 }),
  filename: text("filename").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  kind: varchar("kind", {
    enum: [
      "pdf",
      "image",
      "sheet",
      "document",
      "presentation",
      "audio",
      "video",
      "other",
    ],
  })
    .notNull()
    .default("other"),
  metadata: json("metadata"),
  parentArtifactId: uuid("parentArtifactId"),
  retentionDays: varchar("retentionDays", { length: 16 }).default("30"),
  size: varchar("size", { length: 32 }),
  status: varchar("status", {
    enum: ["uploading", "ready", "processing", "failed", "deleted"],
  })
    .notNull()
    .default("ready"),
  storageKey: text("storageKey").notNull(),
  taskId: uuid("taskId"),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type Artifact = InferSelectModel<typeof artifact>;
