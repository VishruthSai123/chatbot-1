import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { deleteArtifact } from "@/lib/storage";

export type GuestCleanupResult = {
  deletedGuests: number;
  deletedObjects: number;
  errors: number;
};

async function forEachLimit<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        // biome-ignore lint/performance/noAwaitInLoops: this is a bounded worker pool, not a serial loop.
        await run(item);
      }
    })
  );
}

/**
 * Deletes inactive guest accounts and everything they own.
 *
 * Guest mode is the free entry point to Quick Search, not a permanent hosted
 * account. Without this, every visitor row, chat and R2 object lives forever,
 * and the privacy promise ("no account needed for local search") becomes a
 * storage leak.
 *
 * Bulk deletes and bounded storage concurrency matter: the first version did
 * one query per row and timed out at 60 seconds.
 */
export async function cleanupInactiveGuests(input?: {
  inactivityDays?: number;
  limit?: number;
}): Promise<GuestCleanupResult> {
  const inactivityDays = input?.inactivityDays ?? 7;
  const limit = input?.limit ?? 50;

  const rows = (await db.execute(sql`
    select u.id
    from "User" u
    where u.email ~ '^guest-[0-9]+$'
      and u."createdAt" < now() - (${inactivityDays}::int * interval '1 day')
      and not exists (
        select 1 from "Chat" c
        where c."userId" = u.id
          and c."createdAt" > now() - (${inactivityDays}::int * interval '1 day')
      )
    order by u."createdAt" asc
    limit ${limit}
  `)) as unknown as Array<{ id: string }>;

  // The rate-limit table is fixed-window only; old windows are dead weight.
  await db.execute(
    sql`delete from "RateLimit" where "windowStart" < now() - interval '1 day'`
  );

  if (rows.length === 0) {
    return { deletedGuests: 0, deletedObjects: 0, errors: 0 };
  }

  const ids = rows.map((row) => row.id);
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  let deletedObjects = 0;
  let errors = 0;

  console.log("guest cleanup: selected", ids.length);

  const objects = (await db.execute(sql`
    select "storageKey" from "Artifact"
    where "userId" in (${idList})
  `)) as unknown as Array<{ storageKey: string }>;

  console.log("guest cleanup: objects", objects.length);

  await forEachLimit(objects, 10, async (object) => {
    try {
      await deleteArtifact(object.storageKey);
      deletedObjects += 1;
    } catch (error) {
      errors += 1;
      console.warn("Guest object delete failed:", error);
    }
  });

  console.log("guest cleanup: objects deleted", deletedObjects);

  try {
    await db.execute(sql`
      delete from "Vote_v2" where "chatId" in (
        select id from "Chat" where "userId" in (${idList})
      )
    `);
    await db.execute(sql`
      delete from "Stream" where "chatId" in (
        select id from "Chat" where "userId" in (${idList})
      )
    `);
    await db.execute(sql`
      delete from "Message_v2" where "chatId" in (
        select id from "Chat" where "userId" in (${idList})
      )
    `);
    await db.execute(sql`
      delete from "Task" where "chatId" in (
        select id from "Chat" where "userId" in (${idList})
      )
    `);
    await db.execute(sql`delete from "Artifact" where "userId" in (${idList})`);
    await db.execute(
      sql`delete from "Suggestion" where "userId" in (${idList})`
    );
    await db.execute(sql`delete from "Task" where "userId" in (${idList})`);
    await db.execute(
      sql`delete from "LiveSession" where "userId" in (${idList})`
    );
    await db.execute(
      sql`delete from "MediaSession" where "userId" in (${idList})`
    );
    await db.execute(
      sql`delete from "UsageEvent" where "userId" in (${idList})`
    );
    await db.execute(
      sql`delete from "UsageCounter" where "subjectId" in (${idList})`
    );
    await db.execute(
      sql`delete from "UsageReservation" where "subjectId" in (${idList})`
    );
    await db.execute(
      sql`delete from "Entitlement" where "userId" in (${idList})`
    );
    await db.execute(sql`delete from "Document" where "userId" in (${idList})`);
    await db.execute(sql`delete from "Chat" where "userId" in (${idList})`);
    await db.execute(sql`delete from "User" where id in (${idList})`);
  } catch (error) {
    errors += 1;
    console.warn("Guest row delete failed:", error);
  }

  return {
    deletedGuests: rows.length,
    deletedObjects,
    errors,
  };
}
