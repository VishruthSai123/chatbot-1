import "server-only";

import { and, count, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { liveSession } from "@/lib/db/schema";

const DEFAULT_MAX_CONCURRENT = 200;

export type LiveCapacity = {
  active: number;
  max: number;
  ok: boolean;
};

/**
 * Postgres-backed global Live cap.
 *
 * The advisory lock serialises token mints for the few milliseconds it takes to
 * count active sessions, so two concurrent mints cannot both take the last
 * slot. Redis is optional; this works on a plain Supabase database.
 */
export async function checkLiveCapacity(): Promise<LiveCapacity> {
  const max = Math.max(
    1,
    Number(process.env.LIVE_MAX_CONCURRENT ?? DEFAULT_MAX_CONCURRENT) ||
      DEFAULT_MAX_CONCURRENT
  );

  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('spire_live_capacity'))`
    );

    const [row] = await tx
      .select({ value: count() })
      .from(liveSession)
      .where(
        and(
          inArray(liveSession.status, ["reserved", "active"]),
          gt(liveSession.expireAt, new Date())
        )
      );

    const active = Number(row?.value ?? 0);
    return { active, max, ok: active < max };
  });
}
