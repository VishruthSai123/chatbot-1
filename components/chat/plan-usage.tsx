"use client";

import { Crown, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsGuest } from "@/hooks/use-is-guest";
import { formatBytes } from "@/lib/storage/limits";
import { cn } from "@/lib/utils";

type Counter = {
  limit: number;
  reserved: number;
  resetAt: string;
  used: number;
};

type UsagePayload = {
  limits: {
    downloadsPerMonth: number;
    liveMinutesPerMonth: number;
    researchPerMonth: number;
    searchesPerDay: number;
    searchesPerMonth: number;
    storageGb: number;
    tasksPerDay: number;
    tasksPerMonth: number;
    tasksPerWeek: number;
  };
  plan: string;
  planLabel: string;
  usage: {
    liveSecondsMonth: Counter;
    researchMonth: Counter;
    searchesDay: Counter;
    searchesMonth: Counter;
    storageBytes: number;
    storageLimitBytes: number;
    tasksDay: Counter;
    tasksMonth: Counter;
    tasksWeek: Counter;
  };
};

function remaining(counter: Counter): number {
  return Math.max(0, counter.limit - counter.used - counter.reserved);
}

function resetLabel(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

export function PlanUsage({ className }: { className?: string }) {
  const { isGuest, isLoading } = useIsGuest();
  const pathname = usePathname();
  const [data, setData] = useState<UsagePayload | null>(null);

  const load = useCallback(async () => {
    if (isGuest) {
      return;
    }

    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      setData((await response.json()) as UsagePayload);
    } catch {
      // The pill is an aid, not a gate. Keep the last known value.
    }
  }, [isGuest]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    load().catch(() => undefined);
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 60_000);
    const onFocus = () => {
      load().catch(() => undefined);
    };
    const onUsageChanged = () => {
      load().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("spire:usage-changed", onUsageChanged);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("spire:usage-changed", onUsageChanged);
    };
  }, [isLoading, load]);

  if (isLoading) {
    return null;
  }

  if (isGuest) {
    return (
      <Link
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-card/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-card sm:px-2.5",
          className
        )}
        href={`/register?next=${encodeURIComponent(pathname || "/")}`}
      >
        <Sparkles className="size-3" />
        <span className="hidden xl:inline">Sign in for free AI</span>
        <span className="xl:hidden">Sign in</span>
      </Link>
    );
  }

  if (!data) {
    return null;
  }

  const tasksLeft = remaining(data.usage.tasksMonth);
  const isFree = data.plan === "free";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${data.planLabel} plan. ${tasksLeft} tasks left this month. Open usage.`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-card/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-card sm:px-2.5",
            className
          )}
          type="button"
        >
          {isFree ? (
            <Sparkles className="size-3" />
          ) : (
            <Crown className="size-3" />
          )}
          <span className="hidden xl:inline">{data.planLabel}</span>
          {isFree ? (
            <>
              <span className="hidden text-muted-foreground xl:inline">
                {tasksLeft} left this month
              </span>
              <span className="text-muted-foreground xl:hidden">
                {tasksLeft} left
              </span>
            </>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(18rem,calc(100vw-24px))] p-3.5"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">{data.planLabel} plan</p>
          <p className="text-[10px] text-muted-foreground">
            resets {resetLabel(data.usage.tasksMonth.resetAt)}
          </p>
        </div>

        <div className="mt-3 space-y-2 text-[11px]">
          <Row
            label="Chat tasks this month"
            value={`${remaining(data.usage.tasksMonth)} of ${data.limits.tasksPerMonth} left`}
          />
          <Row
            label="Web searches today"
            value={
              data.limits.searchesPerDay > 0
                ? `${remaining(data.usage.searchesDay)} of ${data.limits.searchesPerDay} left`
                : "Not included"
            }
          />
          <Row
            label="Web searches this month"
            value={`${remaining(data.usage.searchesMonth)} of ${data.limits.searchesPerMonth} left`}
          />
          <Row
            label="Deep Research"
            value={
              data.limits.researchPerMonth > 0
                ? `${remaining(data.usage.researchMonth)} of ${data.limits.researchPerMonth} left`
                : "Paid plans only"
            }
          />
          <Row
            label="Live"
            value={`${Math.max(0, Math.floor(remaining(data.usage.liveSecondsMonth) / 60))} of ${data.limits.liveMinutesPerMonth} min left`}
          />
          <Row
            label="Storage"
            value={`${formatBytes(data.usage.storageBytes)} of ${formatBytes(data.usage.storageLimitBytes)}`}
          />
          <Row
            label="Media downloads"
            value={
              data.limits.downloadsPerMonth > 0
                ? `${data.limits.downloadsPerMonth} this month`
                : "Paid plans only"
            }
          />
        </div>

        <p className="mt-3 border-border/50 border-t pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Local search, on-device image/PDF edits and device actions stay free
          and unlimited. Hosted AI is the optional part.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
