import type { InferSelectModel } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

/**
 * Single-use tokens for email verification and password reset.
 *
 * Only a SHA-256 hash of the token is stored. The raw token exists in the
 * email link and in memory for the request that creates it; a database leak
 * therefore cannot be replayed as a reset link.
 */
export const emailToken = pgTable(
  "EmailToken",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    tokenHash: text("tokenHash").notNull(),
    usedAt: timestamp("usedAt", { withTimezone: true }),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    expiresIdx: index("EmailToken_expires_idx").on(table.expiresAt),
    tokenHashIdx: uniqueIndex("EmailToken_tokenHash_key").on(table.tokenHash),
    userPurposeIdx: index("EmailToken_user_purpose_idx").on(
      table.userId,
      table.purpose,
      table.createdAt
    ),
  })
);

export type EmailToken = InferSelectModel<typeof emailToken>;

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
      enum: [
        "text",
        "code",
        "image",
        "sheet",
        "pdf",
        "notebook",
        "doc",
        "audio",
        "slides",
      ],
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

/**
 * Fixed-window request counters backed by Postgres.
 *
 * Production has no Redis configured, so the Redis path in `lib/ratelimit.ts`
 * silently allowed everything. This table makes the IP and registration caps
 * work without adding another service.
 */
export const rateLimit = pgTable("RateLimit", {
  count: integer("count").notNull().default(0),
  key: text("key").primaryKey().notNull(),
  windowStart: timestamp("windowStart", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RateLimit = InferSelectModel<typeof rateLimit>;

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

/**
 * A user's own session for a media platform.
 *
 * Instagram and Facebook serve most of their content only to a signed-in
 * visitor, so a download from them needs the user's cookies. They are a
 * credential, so they are encrypted before they are stored and never written
 * to a log.
 */
export const mediaSession = pgTable("MediaSession", {
  /** The encrypted cookie file. */
  cookies: text("cookies").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  id: uuid("id").notNull().defaultRandom(),
  /** The platform the session belongs to. */
  platform: varchar("platform", { length: 32 }).notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type MediaSession = InferSelectModel<typeof mediaSession>;

// --- Scale rails: usage, entitlements, Live sessions, pricing ---

export const usageEvent = pgTable(
  "UsageEvent",
  {
    bytesIn: bigint("bytesIn", { mode: "number" }).notNull().default(0),
    bytesOut: bigint("bytesOut", { mode: "number" }).notNull().default(0),
    cachedTokens: integer("cachedTokens").notNull().default(0),
    costUsd: numeric("costUsd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }),
    inputTokens: integer("inputTokens").notNull().default(0),
    kind: varchar("kind", { length: 32 }).notNull(),
    lane: varchar("lane", { length: 16 }),
    liveSeconds: integer("liveSeconds").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    model: varchar("model", { length: 64 }),
    orgId: uuid("orgId"),
    outputTokens: integer("outputTokens").notNull().default(0),
    toolOps: integer("toolOps").notNull().default(0),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    idemIdx: uniqueIndex("UsageEvent_idem_idx").on(table.idempotencyKey),
    orgCreatedIdx: index("UsageEvent_org_created_idx").on(
      table.orgId,
      table.createdAt
    ),
    userCreatedIdx: index("UsageEvent_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type UsageEvent = InferSelectModel<typeof usageEvent>;

export const usageCounter = pgTable(
  "UsageCounter",
  {
    kind: varchar("kind", { length: 32 }).notNull(),
    limitValue: numeric("limitValue", { precision: 12, scale: 3 }).notNull(),
    period: varchar("period", { length: 8 }).notNull(),
    periodEnd: timestamp("periodEnd", { withTimezone: true }).notNull(),
    periodStart: timestamp("periodStart", { withTimezone: true }).notNull(),
    reserved: numeric("reserved", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    subjectId: uuid("subjectId").notNull(),
    subjectType: varchar("subjectType", { length: 8 }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    used: numeric("used", { precision: 12, scale: 3 }).notNull().default("0"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.subjectType,
        table.subjectId,
        table.kind,
        table.period,
        table.periodStart,
      ],
    }),
  })
);

export type UsageCounter = InferSelectModel<typeof usageCounter>;

export const usageReservation = pgTable(
  "UsageReservation",
  {
    amount: numeric("amount", { precision: 12, scale: 3 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }),
    kind: varchar("kind", { length: 32 }).notNull(),
    period: varchar("period", { length: 8 }).notNull(),
    periodStart: timestamp("periodStart", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("held"),
    subjectId: uuid("subjectId").notNull(),
    subjectType: varchar("subjectType", { length: 8 }).notNull(),
  },
  (table) => ({
    idemIdx: uniqueIndex("UsageReservation_idem_idx").on(table.idempotencyKey),
    statusIdx: index("UsageReservation_status_idx").on(
      table.status,
      table.expiresAt
    ),
  })
);

export type UsageReservation = InferSelectModel<typeof usageReservation>;

export const entitlement = pgTable(
  "Entitlement",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    flags: jsonb("flags")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId"),
    periodEnd: timestamp("periodEnd", { withTimezone: true }).notNull(),
    periodStart: timestamp("periodStart", { withTimezone: true }).notNull(),
    plan: varchar("plan", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    trialEnd: timestamp("trialEnd", { withTimezone: true }),
    trialStart: timestamp("trialStart", { withTimezone: true }),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    userPeriodIdx: uniqueIndex("Entitlement_user_period_idx").on(
      table.userId,
      table.periodStart
    ),
  })
);

export type Entitlement = InferSelectModel<typeof entitlement>;

export const liveSession = pgTable(
  "LiveSession",
  {
    actualSeconds: integer("actualSeconds").notNull().default(0),
    costUsd: numeric("costUsd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    expireAt: timestamp("expireAt", { withTimezone: true }).notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    model: varchar("model", { length: 64 }).notNull(),
    reservationId: uuid("reservationId").notNull(),
    reservedSeconds: integer("reservedSeconds").notNull(),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull().default("reserved"),
    tokenName: varchar("tokenName", { length: 256 }).notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    expireIdx: index("LiveSession_expire_idx").on(table.status, table.expireAt),
    reservationIdx: uniqueIndex("LiveSession_reservation_idx").on(
      table.reservationId
    ),
    userStatusIdx: index("LiveSession_user_status_idx").on(
      table.userId,
      table.status
    ),
  })
);

export type LiveSession = InferSelectModel<typeof liveSession>;

/**
 * Costed events for the free, accountless Spire quick-answer path.
 *
 * These requests have no `User` row, so they cannot use `UsageEvent.userId`.
 * The install id is a random per-install UUID, not a hardware identifier.
 */
export const quickAnswerEvent = pgTable(
  "QuickAnswerEvent",
  {
    costUsd: numeric("costUsd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    inputTokens: integer("inputTokens").notNull().default(0),
    installId: uuid("installId").notNull(),
    ipHash: text("ipHash"),
    model: varchar("model", { length: 64 }),
    outputTokens: integer("outputTokens").notNull().default(0),
  },
  (table) => ({
    createdIdx: index("QuickAnswerEvent_created_idx").on(table.createdAt),
    installCreatedIdx: index("QuickAnswerEvent_install_created_idx").on(
      table.installId,
      table.createdAt
    ),
  })
);

export type QuickAnswerEvent = InferSelectModel<typeof quickAnswerEvent>;

export const priceBook = pgTable(
  "PriceBook",
  {
    cachedPer1M: numeric("cachedPer1M", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    effectiveFrom: timestamp("effectiveFrom", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effectiveTo", { withTimezone: true }),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    inputPer1M: numeric("inputPer1M", { precision: 10, scale: 4 }).notNull(),
    lane: varchar("lane", { length: 16 }).notNull(),
    liveAudioInPerMin: numeric("liveAudioInPerMin", {
      precision: 10,
      scale: 4,
    }),
    liveAudioOutPerMin: numeric("liveAudioOutPerMin", {
      precision: 10,
      scale: 4,
    }),
    liveVideoInPerMin: numeric("liveVideoInPerMin", {
      precision: 10,
      scale: 4,
    }),
    model: varchar("model", { length: 64 }).notNull(),
    outputPer1M: numeric("outputPer1M", { precision: 10, scale: 4 }).notNull(),
  },
  (table) => ({
    modelLaneFromIdx: uniqueIndex("PriceBook_model_lane_from_idx").on(
      table.model,
      table.lane,
      table.effectiveFrom
    ),
  })
);

export type PriceBook = InferSelectModel<typeof priceBook>;
