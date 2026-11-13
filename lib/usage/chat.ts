import "server-only";

import type { PlanLimits } from "@/lib/entitlements";
import { recordUsage, release, reserve, settle } from "./ledger";
import { chatCost } from "./pricing";

export type ChatReservation = {
  dailyId: string;
  monthlyId: string;
  plan: PlanLimits;
  userId: string;
};

export type ChatUsage = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export async function reserveChatTask(input: {
  plan: PlanLimits;
  userId: string;
}): Promise<ChatReservation> {
  const daily = await reserve({
    amount: 1,
    kind: "chat_tasks",
    limit: input.plan.tasksPerDay,
    period: "day",
    subjectId: input.userId,
    ttlSeconds: 10 * 60,
  });

  try {
    const monthly = await reserve({
      amount: 1,
      kind: "chat_tasks_month",
      limit: input.plan.tasksPerMonth,
      period: "month",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });

    return {
      dailyId: daily.id,
      monthlyId: monthly.id,
      plan: input.plan,
      userId: input.userId,
    };
  } catch (error) {
    await release(daily.id);
    throw error;
  }
}

export async function settleChatTask(input: {
  model: string;
  reservation: ChatReservation;
  usage: ChatUsage | null;
}): Promise<void> {
  const inputTokens = Math.max(0, input.usage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.usage?.outputTokens ?? 0);
  const cachedTokens = Math.max(0, input.usage?.cachedTokens ?? 0);
  // The provider is still called on the standard lane until routing lands.
  // Price what is actually spent, not the plan's future lane.
  const lane = "standard" as const;
  const costUsd = chatCost({
    cachedTokens,
    inputTokens,
    lane,
    model: input.model,
    outputTokens,
  });

  await settle({
    amount: 1,
    event: {
      cachedTokens,
      costUsd,
      idempotencyKey: `chat:${input.reservation.dailyId}`,
      inputTokens,
      kind: "chat",
      lane,
      metadata: {
        plan: input.reservation.plan.plan,
        planLane: input.reservation.plan.lane,
      },
      model: input.model,
      outputTokens,
      userId: input.reservation.userId,
    },
    reservationId: input.reservation.dailyId,
  });

  await settle({
    amount: 1,
    reservationId: input.reservation.monthlyId,
  });
}

export async function releaseChatTask(
  reservation: ChatReservation
): Promise<void> {
  await release(reservation.dailyId);
  await release(reservation.monthlyId);
}

/**
 * Meter-only path for when quota enforcement is off.
 *
 * Cost telemetry must not depend on whether a limit is being enforced. Without
 * this, the deployment looks free because every chat event is missing.
 */
export async function recordChatTask(input: {
  idempotencyKey?: string;
  model: string;
  plan: PlanLimits;
  usage: ChatUsage | null;
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
    idempotencyKey: input.idempotencyKey,
    inputTokens,
    kind: "chat",
    lane: "standard",
    metadata: { plan: input.plan.plan, planLane: input.plan.lane },
    model: input.model,
    outputTokens,
    userId: input.userId,
  });
}
