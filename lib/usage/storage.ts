import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { artifact } from "@/lib/db/schema";

/**
 * Current stored bytes for a user.
 *
 * `Artifact.size` is a string because older rows were written before the column
 * was typed. Only pure-digit values are counted; anything else is treated as
 * unknown rather than crashing the upload path.
 */
export async function getStorageBytes(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${artifact.size} ~ '^[0-9]+$' then ${artifact.size}::bigint else 0 end), 0)`,
    })
    .from(artifact)
    .where(and(eq(artifact.userId, userId), ne(artifact.status, "deleted")));

  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}
