import type { PriceLane } from "@/lib/usage/pricing";

export type PlanId = "free" | "go" | "plus" | "pro" | "business" | "daypass";

export type PlanLimits = {
  downloadsPerMonth: number;
  fileOpsPerMonth: number;
  label: string;
  lane: PriceLane;
  /** Hosted on-device fallback operations allowed per day. 0 = none. */
  lightFileOpsPerDay: number;
  /** Burst limit, separate from the daily/monthly allowance. */
  messagesPerHour: number;
  model: string;
  plan: PlanId;
  researchPerMonth: number;
  /** Web searches allowed per day. 0 = no daily cap. */
  searchesPerDay: number;
  searchesPerMonth: number;
  storageGb: number;
  tasksPerDay: number;
  tasksPerMonth: number;
  /** Weekly fair-use cap inside the monthly allowance. */
  tasksPerWeek: number;
  videoMinutesPerMonth: number;
};

/**
 * The plan table from the growth plan. Limits are deliberately generous on the
 * cheap actions and strict on the expensive ones: Live, video, research and
 * downloads.
 *
 * Pure and importable by the unit suite; the database-backed entitlement lookup
 * lives in `lib/entitlements.ts`.
 */
export const PLANS: Record<PlanId, PlanLimits> = {
  business: {
    downloadsPerMonth: 5,
    fileOpsPerMonth: 200,
    label: "Business",
    lane: "priority",
    lightFileOpsPerDay: 1000,
    messagesPerHour: 300,
    model: "gemini-3.8-flash",
    plan: "business",
    researchPerMonth: 20,
    searchesPerDay: 20,
    searchesPerMonth: 100,
    storageGb: 100,
    tasksPerDay: 200,
    tasksPerMonth: 6000,
    tasksPerWeek: 1000,
    videoMinutesPerMonth: 40,
  },
  daypass: {
    downloadsPerMonth: 0,
    fileOpsPerMonth: 3,
    label: "Day Pass",
    lane: "standard",
    lightFileOpsPerDay: 10,
    messagesPerHour: 30,
    model: "gemini-3.5-flash-lite",
    plan: "daypass",
    researchPerMonth: 0,
    searchesPerDay: 5,
    searchesPerMonth: 5,
    storageGb: 1,
    tasksPerDay: 30,
    tasksPerMonth: 30,
    tasksPerWeek: 30,
    videoMinutesPerMonth: 0,
  },
  free: {
    downloadsPerMonth: 0,
    fileOpsPerMonth: 0,
    label: "Free",
    lane: "flex",
    lightFileOpsPerDay: 10,
    messagesPerHour: 10,
    model: "gemini-3.1-flash-lite",
    plan: "free",
    researchPerMonth: 0,
    searchesPerDay: 1,
    searchesPerMonth: 30,
    storageGb: 0.5,
    tasksPerDay: 6,
    tasksPerMonth: 90,
    tasksPerWeek: 30,
    videoMinutesPerMonth: 0,
  },
  go: {
    downloadsPerMonth: 0,
    fileOpsPerMonth: 10,
    label: "Go",
    lane: "standard",
    lightFileOpsPerDay: 30,
    messagesPerHour: 30,
    model: "gemini-3.5-flash-lite",
    plan: "go",
    researchPerMonth: 1,
    searchesPerDay: 3,
    searchesPerMonth: 10,
    storageGb: 2,
    tasksPerDay: 10,
    tasksPerMonth: 300,
    tasksPerWeek: 50,
    videoMinutesPerMonth: 0,
  },
  plus: {
    downloadsPerMonth: 1,
    fileOpsPerMonth: 30,
    label: "Plus",
    lane: "priority",
    lightFileOpsPerDay: 100,
    messagesPerHour: 60,
    model: "gemini-3.8-flash",
    plan: "plus",
    researchPerMonth: 3,
    searchesPerDay: 5,
    searchesPerMonth: 20,
    storageGb: 5,
    tasksPerDay: 30,
    tasksPerMonth: 900,
    tasksPerWeek: 150,
    videoMinutesPerMonth: 5,
  },
  pro: {
    downloadsPerMonth: 3,
    fileOpsPerMonth: 100,
    label: "Pro",
    lane: "priority",
    lightFileOpsPerDay: 300,
    messagesPerHour: 120,
    model: "gemini-3.8-flash",
    plan: "pro",
    researchPerMonth: 10,
    searchesPerDay: 10,
    searchesPerMonth: 50,
    storageGb: 50,
    tasksPerDay: 100,
    tasksPerMonth: 3000,
    tasksPerWeek: 500,
    videoMinutesPerMonth: 20,
  },
};

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

/**
 * Hidden safety rail for multi-step turns.
 *
 * A user message may need several model calls (tool approval, continuations,
 * regeneration). Those do not consume another visible task, but they must not
 * be unlimited either: a client could otherwise send a continuation-shaped
 * request forever and skip the task counters. This budget is intentionally not
 * shown in the usage pill; it only trips on abusive or runaway turns.
 */
export const CHAT_CALLS_PER_TASK = 6;

export function chatCallLimits(plan: PlanLimits): {
  day: number;
  month: number;
  week: number;
} {
  return {
    day: plan.tasksPerDay * CHAT_CALLS_PER_TASK,
    month: plan.tasksPerMonth * CHAT_CALLS_PER_TASK,
    week: plan.tasksPerWeek * CHAT_CALLS_PER_TASK,
  };
}

export function limitsForPlan(plan: string): PlanLimits {
  return isPlanId(plan) ? PLANS[plan] : PLANS.free;
}
