import { expect, test } from "@playwright/test";

import { periodBounds } from "../../lib/usage/periods";

test.describe("usage period boundaries", () => {
  test("days and months start at UTC midnight on the first", () => {
    const now = new Date("2026-11-15T16:13:37.000Z");
    const day = periodBounds("day", now);
    const month = periodBounds("month", now);

    expect(day.start.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(month.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(month.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  test("weeks run Monday through the next Monday in UTC", () => {
    // Sunday 15 Nov 2026 belongs to the week that started Monday 9 Nov.
    const sunday = periodBounds("week", new Date("2026-11-15T23:59:59.000Z"));
    expect(sunday.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(sunday.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");

    const monday = periodBounds("week", new Date("2026-11-09T00:00:00.000Z"));
    expect(monday.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(monday.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  test("a weekly window is exactly seven days", () => {
    const { end, start } = periodBounds(
      "week",
      new Date("2026-11-15T16:13:37.000Z")
    );
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
