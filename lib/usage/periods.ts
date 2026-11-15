export type UsagePeriod = "day" | "week" | "month";

export type PeriodBounds = {
  start: Date;
  end: Date;
};

/**
 * UTC boundaries for the quota periods.
 *
 * Quotas are stored in UTC so a user cannot reset a daily limit by changing
 * their device timezone. The UI can still display the reset time in local time.
 */
export function periodBounds(
  period: UsagePeriod,
  now: Date = new Date()
): PeriodBounds {
  if (period === "day") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { end, start };
  }

  if (period === "week") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    // getUTCDay(): Sunday is 0. Weeks start on Monday, like the reset copy.
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { end, start };
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  return { end, start };
}
