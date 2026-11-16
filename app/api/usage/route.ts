import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { guestRegex } from "@/lib/constants";
import { getEntitlement } from "@/lib/entitlements";
import { getUsageSummary } from "@/lib/usage/ledger";
import { periodBounds } from "@/lib/usage/periods";
import { getStorageBytes } from "@/lib/usage/storage";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isGuest =
    session.user.type === "guest" || guestRegex.test(session.user.email ?? "");

  if (isGuest) {
    return NextResponse.json(
      {
        error: "auth_required",
        message: "Create a free account to use Spire AI.",
        requiresAuth: true,
      },
      { status: 403 }
    );
  }

  const plan = await getEntitlement(session.user.id);
  const [summary, storageBytes] = await Promise.all([
    getUsageSummary({ subjectId: session.user.id }),
    getStorageBytes(session.user.id),
  ]);

  const counters = new Map(
    summary.map((row) => [`${row.kind}:${row.period}`, row])
  );

  const daily = periodBounds("day");
  const weekly = periodBounds("week");
  const monthly = periodBounds("month");

  const counter = (
    kind: string,
    period: "day" | "week" | "month",
    limit: number
  ) => {
    const row = counters.get(`${kind}:${period}`);
    const fallback =
      period === "day"
        ? daily.end
        : period === "week"
          ? weekly.end
          : monthly.end;
    return {
      limit,
      reserved: row?.reserved ?? 0,
      resetAt: (row?.periodEnd ?? fallback).toISOString(),
      used: row?.used ?? 0,
    };
  };

  return NextResponse.json(
    {
      limits: {
        downloadsPerMonth: plan.downloadsPerMonth,
        messagesPerHour: plan.messagesPerHour,
        researchPerMonth: plan.researchPerMonth,
        searchesPerDay: plan.searchesPerDay,
        searchesPerMonth: plan.searchesPerMonth,
        storageGb: plan.storageGb,
        tasksPerDay: plan.tasksPerDay,
        tasksPerMonth: plan.tasksPerMonth,
        tasksPerWeek: plan.tasksPerWeek,
      },
      plan: plan.plan,
      planLabel: plan.label,
      usage: {
        researchMonth: counter(
          "research_tasks",
          "month",
          plan.researchPerMonth
        ),
        searchesDay: counter("search_tasks", "day", plan.searchesPerDay),
        searchesMonth: counter(
          "search_tasks_month",
          "month",
          plan.searchesPerMonth
        ),
        storageBytes,
        storageLimitBytes: Math.round(plan.storageGb * 1_000_000_000),
        tasksDay: counter("chat_tasks", "day", plan.tasksPerDay),
        tasksMonth: counter("chat_tasks_month", "month", plan.tasksPerMonth),
        tasksWeek: counter("chat_tasks_week", "week", plan.tasksPerWeek),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
