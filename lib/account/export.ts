import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  artifact,
  chat,
  document,
  entitlement,
  liveSession,
  mediaSession,
  message,
  suggestion,
  task,
  taskStep,
  usageCounter,
  usageEvent,
  usageReservation,
  user,
  vote,
} from "@/lib/db/schema";

/**
 * Builds a portable JSON copy of everything Spire stores for an account.
 *
 * Secrets are deliberately excluded: the password hash, media cookies and Live
 * token names never leave the database. Everything the user created — chats,
 * messages, documents, artifacts, tasks and usage — is included.
 */
export async function getUserDataExport(userId: string) {
  if (!userId) {
    return null;
  }

  const [account] = await db
    .select({
      createdAt: user.createdAt,
      email: user.email,
      emailVerified: user.emailVerified,
      id: user.id,
      image: user.image,
      isAnonymous: user.isAnonymous,
      name: user.name,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!account) {
    return null;
  }

  const chats = await db
    .select({
      createdAt: chat.createdAt,
      id: chat.id,
      title: chat.title,
      visibility: chat.visibility,
    })
    .from(chat)
    .where(eq(chat.userId, userId));
  const chatIds = chats.map((row) => row.id);

  const documents = await db
    .select()
    .from(document)
    .where(eq(document.userId, userId));
  const documentIds = documents.map((row) => row.id);

  const tasks = await db.select().from(task).where(eq(task.userId, userId));
  const taskIds = tasks.map((row) => row.id);

  const [
    messages,
    votes,
    suggestions,
    artifacts,
    taskSteps,
    mediaSessions,
    usageEvents,
    usageCounters,
    usageReservations,
    entitlements,
    liveSessions,
  ] = await Promise.all([
    chatIds.length > 0
      ? db.select().from(message).where(inArray(message.chatId, chatIds))
      : Promise.resolve([]),
    chatIds.length > 0
      ? db.select().from(vote).where(inArray(vote.chatId, chatIds))
      : Promise.resolve([]),
    documentIds.length > 0
      ? db
          .select()
          .from(suggestion)
          .where(
            or(
              eq(suggestion.userId, userId),
              inArray(suggestion.documentId, documentIds)
            )
          )
      : db.select().from(suggestion).where(eq(suggestion.userId, userId)),
    db.select().from(artifact).where(eq(artifact.userId, userId)),
    taskIds.length > 0
      ? db.select().from(taskStep).where(inArray(taskStep.taskId, taskIds))
      : Promise.resolve([]),
    db
      .select({
        createdAt: mediaSession.createdAt,
        platform: mediaSession.platform,
        updatedAt: mediaSession.updatedAt,
      })
      .from(mediaSession)
      .where(eq(mediaSession.userId, userId)),
    db.select().from(usageEvent).where(eq(usageEvent.userId, userId)),
    db
      .select()
      .from(usageCounter)
      .where(
        and(
          eq(usageCounter.subjectType, "user"),
          eq(usageCounter.subjectId, userId)
        )
      ),
    db
      .select()
      .from(usageReservation)
      .where(
        and(
          eq(usageReservation.subjectType, "user"),
          eq(usageReservation.subjectId, userId)
        )
      ),
    db.select().from(entitlement).where(eq(entitlement.userId, userId)),
    db
      .select({
        actualSeconds: liveSession.actualSeconds,
        costUsd: liveSession.costUsd,
        createdAt: liveSession.createdAt,
        endedAt: liveSession.endedAt,
        expireAt: liveSession.expireAt,
        id: liveSession.id,
        model: liveSession.model,
        reservedSeconds: liveSession.reservedSeconds,
        startedAt: liveSession.startedAt,
        status: liveSession.status,
      })
      .from(liveSession)
      .where(eq(liveSession.userId, userId)),
  ]);

  return {
    account,
    application: "Spire",
    artifacts,
    chats,
    documents,
    entitlements,
    exportedAt: new Date().toISOString(),
    liveSessions,
    mediaSessions,
    messages,
    schemaVersion: 1,
    suggestions,
    taskSteps,
    tasks,
    usageCounters,
    usageEvents,
    usageReservations,
    votes,
  };
}
