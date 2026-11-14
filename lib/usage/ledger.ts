import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  liveSession,
  usageCounter,
  usageEvent,
  usageReservation,
} from "@/lib/db/schema";
import { periodBounds, type UsagePeriod } from "./periods";
import { liveCost } from "./pricing";

export type SubjectType = "user" | "org" | "device";

export type ReserveInput = {
  amount: number;
  idempotencyKey?: string;
  kind: string;
  limit: number;
  period: UsagePeriod;
  subjectId: string;
  subjectType?: SubjectType;
  ttlSeconds?: number;
};

export type UsageEventInput = {
  bytesIn?: number;
  bytesOut?: number;
  cachedTokens?: number;
  costUsd?: number;
  idempotencyKey?: string;
  inputTokens?: number;
  kind: string;
  lane?: string;
  liveSeconds?: number;
  metadata?: Record<string, unknown>;
  model?: string;
  orgId?: string;
  outputTokens?: number;
  toolOps?: number;
  userId: string;
};

export type SettleInput = {
  amount?: number;
  event?: UsageEventInput;
  reservationId: string;
};

export class QuotaExceededError extends Error {
  readonly details: {
    kind: string;
    limit: number;
    period: UsagePeriod;
    resetAt: string;
    reserved: number;
    used: number;
  };

  constructor(details: QuotaExceededError["details"]) {
    super("quota_exceeded");
    this.name = "QuotaExceededError";
    this.details = details;
  }
}

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function counterWhere(input: {
  kind: string;
  period: UsagePeriod;
  periodStart: Date;
  subjectId: string;
  subjectType: SubjectType;
}) {
  return and(
    eq(usageCounter.subjectType, input.subjectType),
    eq(usageCounter.subjectId, input.subjectId),
    eq(usageCounter.kind, input.kind),
    eq(usageCounter.period, input.period),
    eq(usageCounter.periodStart, input.periodStart)
  );
}

/**
 * Holds capacity before the provider is called. If this returns, the caller may
 * spend; if it throws QuotaExceededError, the caller must not call the provider.
 */
export async function reserve(input: ReserveInput): Promise<{
  amount: number;
  id: string;
  periodEnd: Date;
  periodStart: Date;
}> {
  const subjectType = input.subjectType ?? "user";
  const bounds = periodBounds(input.period);
  const amount = Math.max(0, input.amount);
  const limit = Math.max(0, input.limit);

  return await db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(usageReservation)
        .where(
          and(
            eq(usageReservation.idempotencyKey, input.idempotencyKey),
            eq(usageReservation.status, "held")
          )
        )
        .limit(1);
      if (existing) {
        return {
          amount: num(existing.amount),
          id: existing.id,
          periodEnd: bounds.end,
          periodStart: bounds.start,
        };
      }
    }

    let [counter] = await tx
      .select()
      .from(usageCounter)
      .where(counterWhere({ ...input, periodStart: bounds.start, subjectType }))
      .for("update");

    if (!counter) {
      await tx
        .insert(usageCounter)
        .values({
          kind: input.kind,
          limitValue: String(limit),
          period: input.period,
          periodEnd: bounds.end,
          periodStart: bounds.start,
          subjectId: input.subjectId,
          subjectType,
        })
        .onConflictDoNothing();

      [counter] = await tx
        .select()
        .from(usageCounter)
        .where(
          counterWhere({ ...input, periodStart: bounds.start, subjectType })
        )
        .for("update");
    }

    if (!counter) {
      throw new Error("usage_counter_unavailable");
    }

    const used = num(counter.used);
    const reserved = num(counter.reserved);
    if (used + reserved + amount > limit) {
      throw new QuotaExceededError({
        kind: input.kind,
        limit,
        period: input.period,
        reserved,
        resetAt: bounds.end.toISOString(),
        used,
      });
    }

    if (num(counter.limitValue) !== limit) {
      await tx
        .update(usageCounter)
        .set({ limitValue: String(limit), updatedAt: new Date() })
        .where(
          counterWhere({ ...input, periodStart: bounds.start, subjectType })
        );
    }

    const [reservation] = await tx
      .insert(usageReservation)
      .values({
        amount: String(amount),
        expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 300) * 1000),
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        period: input.period,
        periodStart: bounds.start,
        subjectId: input.subjectId,
        subjectType,
      })
      .returning();

    await tx
      .update(usageCounter)
      .set({
        reserved: String(reserved + amount),
        updatedAt: new Date(),
      })
      .where(
        counterWhere({ ...input, periodStart: bounds.start, subjectType })
      );

    return {
      amount,
      id: reservation.id,
      periodEnd: bounds.end,
      periodStart: bounds.start,
    };
  });
}

/**
 * Converts a hold into usage. Safe to call twice for the same reservation.
 */
export async function settle(input: SettleInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(usageReservation)
      .where(eq(usageReservation.id, input.reservationId))
      .for("update");

    if (!reservation) {
      return;
    }

    if (reservation.status !== "held") {
      return;
    }

    const held = num(reservation.amount);
    const actual = Math.max(0, input.amount ?? held);
    const [counter] = await tx
      .select()
      .from(usageCounter)
      .where(
        counterWhere({
          kind: reservation.kind,
          period: reservation.period as UsagePeriod,
          periodStart: reservation.periodStart,
          subjectId: reservation.subjectId,
          subjectType: reservation.subjectType as SubjectType,
        })
      )
      .for("update");

    if (counter) {
      const reserved = Math.max(0, num(counter.reserved) - held);
      const used = num(counter.used) + actual;
      await tx
        .update(usageCounter)
        .set({
          reserved: String(reserved),
          updatedAt: new Date(),
          used: String(used),
        })
        .where(
          counterWhere({
            kind: reservation.kind,
            period: reservation.period as UsagePeriod,
            periodStart: reservation.periodStart,
            subjectId: reservation.subjectId,
            subjectType: reservation.subjectType as SubjectType,
          })
        );
    }

    await tx
      .update(usageReservation)
      .set({ status: "settled" })
      .where(eq(usageReservation.id, reservation.id));

    if (input.event) {
      const { event } = input;
      await tx
        .insert(usageEvent)
        .values({
          bytesIn: event.bytesIn ?? 0,
          bytesOut: event.bytesOut ?? 0,
          cachedTokens: event.cachedTokens ?? 0,
          costUsd: String(event.costUsd ?? 0),
          idempotencyKey:
            event.idempotencyKey ?? `reservation:${reservation.id}`,
          inputTokens: event.inputTokens ?? 0,
          kind: event.kind,
          lane: event.lane,
          liveSeconds: event.liveSeconds ?? 0,
          metadata: event.metadata,
          model: event.model,
          orgId: event.orgId,
          outputTokens: event.outputTokens ?? 0,
          toolOps: event.toolOps ?? 0,
          userId: event.userId,
        })
        .onConflictDoNothing();
    }
  });
}

/**
 * Gives the hold back without charging. Use when the provider fails before any
 * work was done.
 */
export async function release(reservationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(usageReservation)
      .where(eq(usageReservation.id, reservationId))
      .for("update");

    if (!(reservation && reservation.status === "held")) {
      return;
    }

    const held = num(reservation.amount);
    const [counter] = await tx
      .select()
      .from(usageCounter)
      .where(
        counterWhere({
          kind: reservation.kind,
          period: reservation.period as UsagePeriod,
          periodStart: reservation.periodStart,
          subjectId: reservation.subjectId,
          subjectType: reservation.subjectType as SubjectType,
        })
      )
      .for("update");

    if (counter) {
      await tx
        .update(usageCounter)
        .set({
          reserved: String(Math.max(0, num(counter.reserved) - held)),
          updatedAt: new Date(),
        })
        .where(
          counterWhere({
            kind: reservation.kind,
            period: reservation.period as UsagePeriod,
            periodStart: reservation.periodStart,
            subjectId: reservation.subjectId,
            subjectType: reservation.subjectType as SubjectType,
          })
        );
    }

    await tx
      .update(usageReservation)
      .set({ status: "released" })
      .where(eq(usageReservation.id, reservation.id));
  });
}

/**
 * Writes a costed event without a hold. Use for actions already bounded by
 * another mechanism, such as storage after upload.
 */
export async function recordUsage(event: UsageEventInput): Promise<void> {
  await db
    .insert(usageEvent)
    .values({
      bytesIn: event.bytesIn ?? 0,
      bytesOut: event.bytesOut ?? 0,
      cachedTokens: event.cachedTokens ?? 0,
      costUsd: String(event.costUsd ?? 0),
      idempotencyKey: event.idempotencyKey,
      inputTokens: event.inputTokens ?? 0,
      kind: event.kind,
      lane: event.lane,
      liveSeconds: event.liveSeconds ?? 0,
      metadata: event.metadata,
      model: event.model,
      orgId: event.orgId,
      outputTokens: event.outputTokens ?? 0,
      toolOps: event.toolOps ?? 0,
      userId: event.userId,
    })
    .onConflictDoNothing();
}

export async function getUsageSummary(input: {
  subjectId: string;
  subjectType?: SubjectType;
}): Promise<
  Array<{
    kind: string;
    limit: number;
    period: UsagePeriod;
    periodEnd: Date;
    periodStart: Date;
    reserved: number;
    used: number;
  }>
> {
  const rows = await db
    .select()
    .from(usageCounter)
    .where(
      and(
        eq(usageCounter.subjectType, input.subjectType ?? "user"),
        eq(usageCounter.subjectId, input.subjectId)
      )
    );

  return rows.map((row) => ({
    kind: row.kind,
    limit: num(row.limitValue),
    period: row.period as UsagePeriod,
    periodEnd: row.periodEnd,
    periodStart: row.periodStart,
    reserved: num(row.reserved),
    used: num(row.used),
  }));
}

/**
 * Settles Live holds whose reservation has expired. Other stale holds are
 * released, because their provider call either never started or failed.
 */
export async function expireStaleReservations(
  limit = 200
): Promise<{ released: number; settled: number }> {
  const stale = await db
    .select()
    .from(usageReservation)
    .where(
      and(
        eq(usageReservation.status, "held"),
        lt(usageReservation.expiresAt, new Date())
      )
    )
    .limit(limit);

  let released = 0;
  let settled = 0;

  // Sequential settlement keeps DB load bounded during a cleanup pass.
  for (const reservation of stale) {
    try {
      if (reservation.kind.startsWith("live")) {
        const seconds = Math.round(num(reservation.amount));
        // biome-ignore lint/performance/noAwaitInLoops: cleanup is intentionally sequential.
        const [session] = await db
          .select()
          .from(liveSession)
          .where(eq(liveSession.reservationId, reservation.id))
          .limit(1);

        // A hold without a session is an abandoned token or test row. Release
        // it instead of writing an event for a user that may not exist.
        if (!session) {
          await release(reservation.id);
          released += 1;
          continue;
        }

        const { model, userId } = session;
        const cost = liveCost({ model, seconds });
        await settle({
          amount: seconds,
          event: {
            costUsd: cost,
            idempotencyKey: `reservation:${reservation.id}`,
            kind: "live_audio",
            liveSeconds: seconds,
            metadata: { reason: "reservation_expired" },
            model,
            userId,
          },
          reservationId: reservation.id,
        });
        await db
          .update(liveSession)
          .set({
            actualSeconds: seconds,
            costUsd: String(cost),
            endedAt: new Date(),
            status: "expired",
          })
          .where(eq(liveSession.reservationId, reservation.id));
        settled += 1;
      } else {
        await release(reservation.id);
        released += 1;
      }
    } catch (error) {
      console.error("Stale reservation cleanup failed:", reservation.id, error);
    }
  }

  return { released, settled };
}
