import "server-only";

import { inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quickAnswerEvent } from "@/lib/db/schema";

/**
 * Trims the accountless quick-answer cost log.
 *
 * The rows are only needed for the daily budget and recent abuse checks. Older
 * rows are deleted in bounded batches so one maintenance pass stays cheap.
 */
export async function cleanupQuickAnswerEvents(input?: {
  limit?: number;
  olderThanDays?: number;
}): Promise<{ deleted: number; errors: number }> {
  const limit = input?.limit ?? 5000;
  const olderThanDays = input?.olderThanDays ?? 90;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  try {
    const rows = await db
      .select({ id: quickAnswerEvent.id })
      .from(quickAnswerEvent)
      .where(lt(quickAnswerEvent.createdAt, cutoff))
      .limit(limit);

    if (rows.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    const deleted = await db
      .delete(quickAnswerEvent)
      .where(
        inArray(
          quickAnswerEvent.id,
          rows.map((row) => row.id)
        )
      )
      .returning({ id: quickAnswerEvent.id });

    return { deleted: deleted.length, errors: 0 };
  } catch (error) {
    console.error("Quick answer cleanup failed:", error);
    return { deleted: 0, errors: 1 };
  }
}
