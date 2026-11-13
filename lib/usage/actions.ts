import "server-only";

import { release, reserve, settle } from "./ledger";

export type ActionReservation = {
  id: string;
  kind: string;
  userId: string;
};

export async function reserveAction(input: {
  amount?: number;
  kind: string;
  limit: number;
  period?: "day" | "month";
  subjectId: string;
  ttlSeconds?: number;
}): Promise<ActionReservation> {
  const reservation = await reserve({
    amount: input.amount ?? 1,
    kind: input.kind,
    limit: input.limit,
    period: input.period ?? "month",
    subjectId: input.subjectId,
    ttlSeconds: input.ttlSeconds ?? 10 * 60,
  });

  return {
    id: reservation.id,
    kind: input.kind,
    userId: input.subjectId,
  };
}

export async function settleAction(input: {
  costUsd?: number;
  eventKind: string;
  metadata?: Record<string, unknown>;
  reservation: ActionReservation;
  toolOps?: number;
}): Promise<void> {
  await settle({
    amount: 1,
    event: {
      costUsd: input.costUsd ?? 0,
      idempotencyKey: `action:${input.reservation.id}`,
      kind: input.eventKind,
      metadata: input.metadata,
      toolOps: input.toolOps ?? 0,
      userId: input.reservation.userId,
    },
    reservationId: input.reservation.id,
  });
}

export async function releaseAction(
  reservation: ActionReservation
): Promise<void> {
  await release(reservation.id);
}
