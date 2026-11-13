import "server-only";

import type { PlanLimits } from "@/lib/entitlements";
import { recordUsage, release, reserve, settle } from "./ledger";
import { chatCost } from "./pricing";

export type ResearchReservation = {
  id: string;
  plan: PlanLimits;
  userId: string;
};

export type ResearchUsage = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/** One deep-research report against the plan's monthly allowance. */
export async function reserveResearchTask(input: {
  plan: PlanLimits;
  userId: string;
}): Promise<ResearchReservation> {
  const reservation = await reserve({
    amount: 1,
    kind: "research_tasks",
    limit: input.plan.researchPerMonth,
    period: "month",
    subjectId: input.userId,
    ttlSeconds: 15 * 60,
  });

  return {
    id: reservation.id,
    plan: input.plan,
    userId: input.userId,
  };
}

export async function settleResearchTask(input: {
  model: string;
  reservation: ResearchReservation;
  searches?: number;
  usage?: ResearchUsage | null;
}): Promise<void> {
  const inputTokens = Math.max(0, input.usage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.usage?.outputTokens ?? 0);
  const cachedTokens = Math.max(0, input.usage?.cachedTokens ?? 0);

  await settle({
    amount: 1,
    event: {
      cachedTokens,
      costUsd: chatCost({
        cachedTokens,
        inputTokens,
        lane: "standard",
        model: input.model,
        outputTokens,
      }),
      idempotencyKey: `research:${input.reservation.id}`,
      inputTokens,
      kind: "research",
      lane: "standard",
      metadata: {
        plan: input.reservation.plan.plan,
        searches: input.searches ?? 0,
      },
      model: input.model,
      outputTokens,
      toolOps: 1,
      userId: input.reservation.userId,
    },
    reservationId: input.reservation.id,
  });
}

export async function releaseResearchTask(
  reservation: ResearchReservation
): Promise<void> {
  await release(reservation.id);
}

/** Meter-only path used while the paid ladder is not enforced. */
export async function recordResearchTask(input: {
  model: string;
  plan: PlanLimits;
  searches?: number;
  usage?: ResearchUsage | null;
  userId: string;
}): Promise<void> {
  const inputTokens = Math.max(0, input.usage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.usage?.outputTokens ?? 0);
  const cachedTokens = Math.max(0, input.usage?.cachedTokens ?? 0);

  await recordUsage({
    cachedTokens,
    costUsd: chatCost({
      cachedTokens,
      inputTokens,
      lane: "standard",
      model: input.model,
      outputTokens,
    }),
    inputTokens,
    kind: "research",
    lane: "standard",
    metadata: { plan: input.plan.plan, searches: input.searches ?? 0 },
    model: input.model,
    outputTokens,
    toolOps: 1,
    userId: input.userId,
  });
}
