import "server-only";

import type { PlanLimits } from "@/lib/entitlements";
import { chatCallLimits } from "@/lib/plans";
import { recordUsage, release, reserve, settle } from "./ledger";
import { chatCost } from "./pricing";

export type ChatReservation = {
  dailyId: string;
  monthlyId: string;
  plan: PlanLimits;
  userId: string;
  weeklyId: string;
};

/**
 * Hidden per-request holds for a multi-step turn.
 *
 * These counters are separate from the visible task counters so a continuation
 * does not spend the user's monthly allowance, while a forged stream of
 * continuation-shaped requests still has a hard ceiling.
 */
export type ChatCallReservation = {
  dailyId: string;
  monthlyId: string;
  userId: string;
  weeklyId: string;
};

export type ChatUsage = {
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/**
 * Holds every window before the provider is called.
 *
 * The monthly allowance is the real budget; the week and day counters are
 * fair-use guardrails that stop a single burst from spending the month in a
 * few hours. Check the most expensive window first so a used-up month fails
 * without creating two rows that are immediately released.
 */
export async function reserveChatTask(input: {
  plan: PlanLimits;
  userId: string;
}): Promise<ChatReservation> {
  const held: string[] = [];

  try {
    const monthly = await reserve({
      amount: 1,
      kind: "chat_tasks_month",
      limit: input.plan.tasksPerMonth,
      period: "month",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(monthly.id);

    const weekly = await reserve({
      amount: 1,
      kind: "chat_tasks_week",
      limit: input.plan.tasksPerWeek,
      period: "week",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(weekly.id);

    const daily = await reserve({
      amount: 1,
      kind: "chat_tasks",
      limit: input.plan.tasksPerDay,
      period: "day",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(daily.id);

    return {
      dailyId: daily.id,
      monthlyId: monthly.id,
      plan: input.plan,
      userId: input.userId,
      weeklyId: weekly.id,
    };
  } catch (error) {
    await Promise.allSettled(held.map((id) => release(id)));
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
    reservationId: input.reservation.weeklyId,
  });

  await settle({
    amount: 1,
    reservationId: input.reservation.monthlyId,
  });
}

export async function releaseChatTask(
  reservation: ChatReservation
): Promise<void> {
  await Promise.all([
    release(reservation.dailyId),
    release(reservation.weeklyId),
    release(reservation.monthlyId),
  ]);
}

/**
 * Holds the hidden model-call budget for a continuation, approval or
 * regeneration request. The visible task counters are deliberately not
 * touched here.
 */
export async function reserveChatCall(input: {
  plan: PlanLimits;
  userId: string;
}): Promise<ChatCallReservation> {
  const limits = chatCallLimits(input.plan);
  const held: string[] = [];

  try {
    const monthly = await reserve({
      amount: 1,
      kind: "chat_calls_month",
      limit: limits.month,
      period: "month",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(monthly.id);

    const weekly = await reserve({
      amount: 1,
      kind: "chat_calls_week",
      limit: limits.week,
      period: "week",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(weekly.id);

    const daily = await reserve({
      amount: 1,
      kind: "chat_calls_day",
      limit: limits.day,
      period: "day",
      subjectId: input.userId,
      ttlSeconds: 10 * 60,
    });
    held.push(daily.id);

    return {
      dailyId: daily.id,
      monthlyId: monthly.id,
      userId: input.userId,
      weeklyId: weekly.id,
    };
  } catch (error) {
    await Promise.allSettled(held.map((id) => release(id)));
    throw error;
  }
}

export async function settleChatCall(
  reservation: ChatCallReservation
): Promise<void> {
  await settle({ amount: 1, reservationId: reservation.dailyId });
  await settle({ amount: 1, reservationId: reservation.weeklyId });
  await settle({ amount: 1, reservationId: reservation.monthlyId });
}

export async function releaseChatCall(
  reservation: ChatCallReservation
): Promise<void> {
  await Promise.all([
    release(reservation.dailyId),
    release(reservation.weeklyId),
    release(reservation.monthlyId),
  ]);
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
