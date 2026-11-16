import "server-only";

import { and, desc, eq, gt, lte } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { entitlement } from "@/lib/db/schema";
import type { PlanLimits } from "@/lib/plans";
import { limitsForPlan, PLANS } from "@/lib/plans";

export type { PlanId, PlanLimits } from "@/lib/plans";
export { isPlanId, limitsForPlan, PLANS } from "@/lib/plans";

function numberOverride(
  flags: Record<string, unknown> | null | undefined,
  key: keyof PlanLimits,
  fallback: number
): number {
  const value = flags?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function getEntitlement(userId: string): Promise<PlanLimits> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(entitlement)
    .where(
      and(
        eq(entitlement.userId, userId),
        lte(entitlement.periodStart, now),
        gt(entitlement.periodEnd, now)
      )
    )
    .orderBy(desc(entitlement.periodStart))
    .limit(1);

  if (!(row && (row.status === "active" || row.status === "trialing"))) {
    return PLANS.free;
  }

  const plan = limitsForPlan(row.plan);
  const flags = row.flags ?? {};
  return {
    ...plan,
    downloadsPerMonth: numberOverride(
      flags,
      "downloadsPerMonth",
      plan.downloadsPerMonth
    ),
    fileOpsPerMonth: numberOverride(
      flags,
      "fileOpsPerMonth",
      plan.fileOpsPerMonth
    ),
    lightFileOpsPerDay: numberOverride(
      flags,
      "lightFileOpsPerDay",
      plan.lightFileOpsPerDay
    ),
    messagesPerHour: numberOverride(
      flags,
      "messagesPerHour",
      plan.messagesPerHour
    ),
    researchPerMonth: numberOverride(
      flags,
      "researchPerMonth",
      plan.researchPerMonth
    ),
    searchesPerDay: numberOverride(
      flags,
      "searchesPerDay",
      plan.searchesPerDay
    ),
    searchesPerMonth: numberOverride(
      flags,
      "searchesPerMonth",
      plan.searchesPerMonth
    ),
    storageGb: numberOverride(flags, "storageGb", plan.storageGb),
    tasksPerDay: numberOverride(flags, "tasksPerDay", plan.tasksPerDay),
    tasksPerMonth: numberOverride(flags, "tasksPerMonth", plan.tasksPerMonth),
    tasksPerWeek: numberOverride(flags, "tasksPerWeek", plan.tasksPerWeek),
    videoMinutesPerMonth: numberOverride(
      flags,
      "videoMinutesPerMonth",
      plan.videoMinutesPerMonth
    ),
  };
}

/**
 * Creates the current free entitlement if it does not exist. Paid entitlements
 * are written by the billing webhook, not by this function.
 */
export async function ensureEntitlement(userId: string): Promise<void> {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  await db
    .insert(entitlement)
    .values({
      periodEnd,
      periodStart,
      plan: "free",
      status: "active",
      userId,
    })
    .onConflictDoNothing();
}
