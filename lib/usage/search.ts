import "server-only";

import type { PlanLimits } from "@/lib/entitlements";
import { recordUsage, release, reserve, settle } from "./ledger";
import { chatCost } from "./pricing";

export type SearchReservation = {
  ids: string[];
  plan: PlanLimits;
  userId: string;
};

export type SearchUsage = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/**
 * Reserves one web search.
 *
 * Free gets a daily limit (1/day) and a monthly backstop (30/month). Paid plans
 * are monthly-only unless a daily limit is explicitly set. Both counters are
 * reserved before the provider is called, so parallel requests cannot slip past
 * the allowance.
 */
export async function reserveSearchTask(input: {
  plan: PlanLimits;
  userId: string;
}): Promise<SearchReservation> {
  const ids: string[] = [];

  try {
    if (input.plan.searchesPerDay > 0) {
      const daily = await reserve({
        amount: 1,
        kind: "search_tasks",
        limit: input.plan.searchesPerDay,
        period: "day",
        subjectId: input.userId,
        ttlSeconds: 5 * 60,
      });
      ids.push(daily.id);
    }

    const monthly = await reserve({
      amount: 1,
      kind: "search_tasks_month",
      limit: input.plan.searchesPerMonth,
      period: "month",
      subjectId: input.userId,
      ttlSeconds: 5 * 60,
    });
    ids.push(monthly.id);

    return { ids, plan: input.plan, userId: input.userId };
  } catch (error) {
    await Promise.allSettled(ids.map((id) => release(id)));
    throw error;
  }
}

/** Settles the counters and writes exactly one costed search event. */
export async function settleSearchTask(input: {
  model: string;
  provider?: string;
  reservation: SearchReservation;
  usage?: SearchUsage | null;
}): Promise<void> {
  await Promise.all(
    input.reservation.ids.map((id) => settle({ amount: 1, reservationId: id }))
  );

  await recordUsage(buildSearchEvent(input));
}

/** Meter-only path used while quota enforcement is off. */
export async function recordSearchTask(input: {
  model: string;
  plan: PlanLimits;
  provider?: string;
  usage?: SearchUsage | null;
  userId: string;
}): Promise<void> {
  await recordUsage(buildSearchEvent(input));
}

export async function releaseSearchTask(
  reservation: SearchReservation
): Promise<void> {
  await Promise.allSettled(reservation.ids.map((id) => release(id)));
}

function buildSearchEvent(input: {
  model: string;
  plan?: PlanLimits;
  provider?: string;
  reservation?: SearchReservation;
  usage?: SearchUsage | null;
  userId?: string;
}) {
  const inputTokens = Math.max(0, input.usage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.usage?.outputTokens ?? 0);
  const cachedTokens = Math.max(0, input.usage?.cachedTokens ?? 0);
  const costUsd = chatCost({
    cachedTokens,
    inputTokens,
    lane: "standard",
    model: input.model,
    outputTokens,
  });

  return {
    cachedTokens,
    costUsd,
    idempotencyKey: input.reservation?.ids[0]
      ? `search:${input.reservation.ids[0]}`
      : undefined,
    inputTokens,
    kind: "search",
    lane: "standard",
    metadata: {
      plan: input.plan?.plan,
      provider: input.provider,
    },
    model: input.model,
    outputTokens,
    toolOps: 1,
    userId: (input.userId ?? input.reservation?.userId) as string,
  };
}
