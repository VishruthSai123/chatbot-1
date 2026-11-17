import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import { db } from "./client";
import {
  artifact,
  type Chat,
  chat,
  type DBMessage,
  document,
  entitlement,
  liveSession,
  type MediaSession,
  mediaSession,
  message,
  type Suggestion,
  stream,
  suggestion,
  task,
  taskStep,
  type User,
  usageCounter,
  usageEvent,
  usageReservation,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

export function isValidUUID(str?: string | null): boolean {
  if (!str || typeof str !== "string") {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str
  );
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/** Returns the account row, including the password hash, for server-side checks. */
export async function getUserById(id: string): Promise<User | undefined> {
  try {
    const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
    return row;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

/**
 * Turns the current guest into a registered account.
 *
 * A guest who signs up keeps the same user row, and therefore every chat,
 * document and notebook they made while browsing. Creating a second user would
 * hand them an empty account and strand the work they had just been told to
 * save.
 */
export async function upgradeGuestUser({
  email,
  id,
  password,
}: {
  email: string;
  id: string;
  password: string;
}) {
  try {
    const [upgraded] = await db
      .update(user)
      .set({
        email,
        isAnonymous: false,
        name: email,
        password: generateHashedPassword(password),
        updatedAt: new Date(),
      })
      .where(eq(user.id, id))
      .returning({ email: user.email, id: user.id });

    return upgraded;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function setEmailVerified(userId: string) {
  try {
    const [updated] = await db
      .update(user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning({ email: user.email, id: user.id });

    return updated;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateUserPassword(userId: string, password: string) {
  try {
    const [updated] = await db
      .update(user)
      .set({
        emailVerified: true,
        password: generateHashedPassword(password),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
      .returning({ email: user.email, id: user.id });

    return updated;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * Moves an anonymous visitor's work onto the account they just signed in to.
 *
 * Registration upgrades the guest row, so nothing needs moving there. Signing
 * in to an existing account is different: the session cookie is replaced, and
 * every chat or file made as a guest would be stranded on a row nobody can
 * reach. The sign-in prompt promises the work is kept, so keep it.
 */
export async function claimGuestWork({
  fromUserId,
  toUserId,
}: {
  fromUserId: string;
  toUserId: string;
}) {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(chat)
        .set({ userId: toUserId })
        .where(eq(chat.userId, fromUserId));
      await tx
        .update(document)
        .set({ userId: toUserId })
        .where(eq(document.userId, fromUserId));
      await tx
        .update(suggestion)
        .set({ userId: toUserId })
        .where(eq(suggestion.userId, fromUserId));
      await tx
        .update(task)
        .set({ userId: toUserId })
        .where(eq(task.userId, fromUserId));
      await tx
        .update(artifact)
        .set({ userId: toUserId })
        .where(eq(artifact.userId, fromUserId));
      await tx
        .update(mediaSession)
        .set({ userId: toUserId })
        .where(eq(mediaSession.userId, fromUserId));
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      email: user.email,
      id: user.id,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db.insert(chat).values({
      createdAt: new Date(),
      id,
      title,
      userId,
      visibility,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    return await db.transaction(async (tx) => {
      const userChats = await tx
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, userId));

      if (userChats.length === 0) {
        return { deletedCount: 0 };
      }

      const chatIds = userChats.map((c) => c.id);

      const userTasks = await tx
        .select({ id: task.id })
        .from(task)
        .where(or(eq(task.userId, userId), inArray(task.chatId, chatIds)));
      const taskIds = userTasks.map((row) => row.id);

      if (taskIds.length > 0) {
        await tx.delete(taskStep).where(inArray(taskStep.taskId, taskIds));
      }
      await tx
        .delete(task)
        .where(or(eq(task.userId, userId), inArray(task.chatId, chatIds)));

      await tx.delete(vote).where(inArray(vote.chatId, chatIds));
      await tx.delete(message).where(inArray(message.chatId, chatIds));
      await tx.delete(stream).where(inArray(stream.chatId, chatIds));

      // Library files outlive their chat. Detach them before the chat rows go.
      await tx
        .update(artifact)
        .set({ chatId: null, updatedAt: new Date() })
        .where(inArray(artifact.chatId, chatIds));

      const deletedChats = await tx
        .delete(chat)
        .where(eq(chat.userId, userId))
        .returning();

      return { deletedCount: deletedChats.length };
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/** Lightweight title search used by Quick Search's Spire library section. */
export async function searchChatsByUserId({
  id,
  limit,
  query,
}: {
  id: string;
  limit: number;
  query: string;
}) {
  try {
    return await db
      .select({
        createdAt: chat.createdAt,
        id: chat.id,
        title: chat.title,
      })
      .from(chat)
      .where(and(eq(chat.userId, id), ilike(chat.title, `%${query}%`)))
      .orderBy(desc(chat.createdAt))
      .limit(limit);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatById({ id }: { id: string }) {
  if (!isValidUUID(id)) {
    return null;
  }
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

/**
 * Inserts messages without overwriting existing rows.
 *
 * Live saves the transcript after every completed turn, so the same message IDs
 * are sent repeatedly. Existing IDs are ignored, which makes the save idempotent
 * without letting a client rewrite someone else's message.
 */
export async function saveMessagesIfAbsent({
  messages,
}: {
  messages: DBMessage[];
}) {
  if (messages.length === 0) {
    return;
  }
  try {
    return await db
      .insert(message)
      .values(messages)
      .onConflictDoNothing({ target: message.id });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (!isValidUUID(id)) {
    return [];
  }
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      isUpvoted: type === "up",
      messageId,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  const validId = isValidUUID(id) ? id : generateUUID();
  try {
    return await db
      .insert(document)
      .values({
        content,
        createdAt: new Date(),
        id: validId,
        kind,
        title,
        userId,
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  if (!isValidUUID(id)) {
    return [];
  }
  try {
    const docs = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const [latest] = docs;
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  if (!isValidUUID(id)) {
    return [];
  }
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * A user's documents, newest first.
 *
 * This is the Library: everything the tools have produced, without the file
 * bodies. `content` is deliberately not selected — a document descriptor can
 * carry a whole document's text, and a list of fifty of them would be megabytes
 * for a screen that only needs titles.
 */
export async function getDocumentsForUser({
  kind,
  limit = 50,
  offset = 0,
  query,
  userId,
}: {
  kind?:
    | "audio"
    | "code"
    | "doc"
    | "image"
    | "notebook"
    | "pdf"
    | "sheet"
    | "slides"
    | "text";
  limit?: number;
  offset?: number;
  query?: string;
  userId: string;
}): Promise<
  { createdAt: Date; id: string; kind: string | null; title: string }[]
> {
  try {
    return await db
      .select({
        createdAt: document.createdAt,
        id: document.id,
        kind: document.kind,
        title: document.title,
      })
      .from(document)
      .where(
        and(
          eq(document.userId, userId),
          kind ? eq(document.kind, kind) : undefined,
          query ? ilike(document.title, `%${query}%`) : undefined
        )
      )
      .orderBy(desc(document.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getDocumentById({ id }: { id: string }) {
  if (!isValidUUID(id)) {
    return;
  }
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getLatestDocumentByKind({
  userId,
  kind,
}: {
  userId: string;
  kind: ArtifactKind;
}) {
  try {
    const [latestDoc] = await db
      .select()
      .from(document)
      .where(and(eq(document.userId, userId), eq(document.kind, kind)))
      .orderBy(desc(document.createdAt))
      .limit(1);

    return latestDoc;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getRecentDocumentsByKind({
  userId,
  kind,
  limit = 10,
}: {
  userId: string;
  kind: ArtifactKind;
  limit?: number;
}) {
  try {
    return await db
      .select()
      .from(document)
      .where(and(eq(document.userId, userId), eq(document.kind, kind)))
      .orderBy(desc(document.createdAt))
      .limit(limit);
  } catch (error) {
    console.warn("Failed to query recent documents by kind:", error);
    return [];
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  if (!isValidUUID(id)) {
    return [];
  }
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch {
    // Best effort title update.
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours?: number;
}) {
  try {
    const filters = [eq(chat.userId, id), eq(message.role, "user")];
    if (typeof differenceInHours === "number") {
      filters.push(
        gte(
          message.createdAt,
          new Date(Date.now() - differenceInHours * 60 * 60 * 1000)
        )
      );
    }

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(and(...filters))
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ chatId, createdAt: new Date(), id: streamId });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * Stores a user's media session.
 *
 * The cookies arrive already encrypted: this layer deals in bytes and knows
 * nothing about what they are.
 */
export async function saveMediaSession({
  cookies,
  platform,
  userId,
}: {
  cookies: string;
  platform: string;
  userId: string;
}): Promise<void> {
  try {
    await db
      .insert(mediaSession)
      .values({
        cookies,
        platform,
        updatedAt: new Date(),
        userId,
      })
      .onConflictDoUpdate({
        set: { cookies, updatedAt: new Date() },
        target: [mediaSession.userId, mediaSession.platform],
      })
      .execute();
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * The user's session for one platform, if they have stored one.
 */
export async function getMediaSession({
  platform,
  userId,
}: {
  platform: string;
  userId: string;
}): Promise<MediaSession | null> {
  try {
    const rows = await db
      .select()
      .from(mediaSession)
      .where(
        and(
          eq(mediaSession.userId, userId),
          eq(mediaSession.platform, platform)
        )
      )
      .limit(1)
      .execute();

    return rows[0] ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * Every platform the user has a session for.
 */
export async function getMediaSessionPlatforms({
  userId,
}: {
  userId: string;
}): Promise<string[]> {
  try {
    const rows = await db
      .select({ platform: mediaSession.platform })
      .from(mediaSession)
      .where(eq(mediaSession.userId, userId))
      .execute();

    return rows.map(({ platform }) => platform);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * Forgets the user's session for one platform.
 */
export async function deleteMediaSession({
  platform,
  userId,
}: {
  platform: string;
  userId: string;
}): Promise<void> {
  try {
    await db
      .delete(mediaSession)
      .where(
        and(
          eq(mediaSession.userId, userId),
          eq(mediaSession.platform, platform)
        )
      )
      .execute();
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/**
 * Permanently removes every row owned by an account.
 *
 * Storage objects are deleted by the caller first because the keys live in the
 * `Artifact` table. The transaction keeps the relational cleanup atomic: a
 * failure rolls back instead of leaving a half-deleted account.
 */
export async function deleteUserAccountData({
  userId,
}: {
  userId: string;
}): Promise<{
  artifacts: number;
  chats: number;
  documents: number;
  messages: number;
  tasks: number;
  usageEvents: number;
}> {
  if (!userId) {
    throw new ChatbotError("bad_request:database", {
      cause: new Error("A user id is required."),
    });
  }

  try {
    return await db.transaction(async (tx) => {
      const userChats = await tx
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, userId));
      const chatIds = userChats.map((row) => row.id);

      const taskScope =
        chatIds.length > 0
          ? or(eq(task.userId, userId), inArray(task.chatId, chatIds))
          : eq(task.userId, userId);
      const userTasks = await tx
        .select({ id: task.id })
        .from(task)
        .where(taskScope);
      const taskIds = userTasks.map((row) => row.id);

      if (taskIds.length > 0) {
        await tx.delete(taskStep).where(inArray(taskStep.taskId, taskIds));
      }
      const deletedTasks = await tx.delete(task).where(taskScope).returning({
        id: task.id,
      });

      if (chatIds.length > 0) {
        await tx.delete(vote).where(inArray(vote.chatId, chatIds));
      }
      const deletedMessages =
        chatIds.length > 0
          ? await tx
              .delete(message)
              .where(inArray(message.chatId, chatIds))
              .returning({ id: message.id })
          : [];

      if (chatIds.length > 0) {
        await tx.delete(stream).where(inArray(stream.chatId, chatIds));
      }

      const userDocuments = await tx
        .select({ id: document.id })
        .from(document)
        .where(eq(document.userId, userId));
      const documentIds = userDocuments.map((row) => row.id);

      await tx
        .delete(suggestion)
        .where(
          documentIds.length > 0
            ? or(
                eq(suggestion.userId, userId),
                inArray(suggestion.documentId, documentIds)
              )
            : eq(suggestion.userId, userId)
        );
      const deletedDocuments = await tx
        .delete(document)
        .where(eq(document.userId, userId))
        .returning({ id: document.id });

      const artifactScope =
        chatIds.length > 0
          ? or(eq(artifact.userId, userId), inArray(artifact.chatId, chatIds))
          : eq(artifact.userId, userId);
      const deletedArtifacts = await tx
        .delete(artifact)
        .where(artifactScope)
        .returning({ id: artifact.id });

      await tx.delete(mediaSession).where(eq(mediaSession.userId, userId));
      await tx.delete(liveSession).where(eq(liveSession.userId, userId));
      const deletedUsageEvents = await tx
        .delete(usageEvent)
        .where(eq(usageEvent.userId, userId))
        .returning({ id: usageEvent.id });
      await tx
        .delete(usageCounter)
        .where(
          and(
            eq(usageCounter.subjectType, "user"),
            eq(usageCounter.subjectId, userId)
          )
        );
      await tx
        .delete(usageReservation)
        .where(
          and(
            eq(usageReservation.subjectType, "user"),
            eq(usageReservation.subjectId, userId)
          )
        );
      await tx.delete(entitlement).where(eq(entitlement.userId, userId));

      const deletedChats =
        chatIds.length > 0
          ? await tx
              .delete(chat)
              .where(eq(chat.userId, userId))
              .returning({ id: chat.id })
          : [];

      await tx.delete(user).where(eq(user.id, userId));

      return {
        artifacts: deletedArtifacts.length,
        chats: deletedChats.length,
        documents: deletedDocuments.length,
        messages: deletedMessages.length,
        tasks: deletedTasks.length,
        usageEvents: deletedUsageEvents.length,
      };
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}
