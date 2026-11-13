import type { PlanLimits } from "@/lib/entitlements";
import type { ToolQuotaClass } from "@/lib/tools/quota-class";
import {
  type ActionReservation,
  reserveAction,
  settleAction,
} from "@/lib/usage/actions";
import { recordUsage } from "@/lib/usage/ledger";

export {
  classifyToolAction,
  type ToolQuotaClass,
} from "@/lib/tools/quota-class";

export class PlanFeatureError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super("plan_feature_required");
    this.name = "PlanFeatureError";
    this.feature = feature;
  }
}

/**
 * Reserves the right allowance for an action.
 *
 * `storage` never reserves. Free `light` actions have a daily safety allowance
 * for browser fallbacks; paid plans use the monthly file-op pool. `heavy`
 * actions require a paid plan.
 */
export async function reserveToolQuota(input: {
  plan: PlanLimits;
  quotaClass: ToolQuotaClass;
  userId: string;
}): Promise<ActionReservation | null> {
  if (input.quotaClass === "storage") {
    return null;
  }

  if (input.quotaClass === "heavy" && input.plan.fileOpsPerMonth <= 0) {
    throw new PlanFeatureError("heavy_tools");
  }

  if (input.plan.plan === "free" && input.quotaClass === "light") {
    return await reserveAction({
      kind: "light_file_ops",
      limit: input.plan.lightFileOpsPerDay,
      period: "day",
      subjectId: input.userId,
    });
  }

  return await reserveAction({
    kind: "file_ops",
    limit: input.plan.fileOpsPerMonth,
    period: "month",
    subjectId: input.userId,
  });
}

export async function settleToolQuota(input: {
  action: string;
  family: string;
  quotaClass: ToolQuotaClass;
  reservation: ActionReservation | null;
  userId: string;
}): Promise<void> {
  const metadata = {
    action: input.action,
    class: input.quotaClass,
    family: input.family,
  };

  if (input.reservation) {
    await settleAction({
      costUsd: 0,
      eventKind: "tool",
      metadata,
      reservation: input.reservation,
      toolOps: input.quotaClass === "storage" ? 0 : 1,
    });
    return;
  }

  await recordUsage({
    costUsd: 0,
    kind: "tool",
    metadata,
    toolOps: input.quotaClass === "storage" ? 0 : 1,
    userId: input.userId,
  });
}
