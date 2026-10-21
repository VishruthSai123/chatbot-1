import { expect, test } from "@playwright/test";

import {
  coerceRows,
  computeSummaryStats,
  filterRows,
  inferColumnType,
  isNullLike,
  removeDuplicateRows,
  type SheetRow,
  sortRows,
  uniqueHeaders,
} from "../../lib/sheet/operations";
import { decodeSheetRef, encodeSheetRef } from "../../lib/sheet/ref";

const SALES: SheetRow[] = [
  { Active: true, Note: "good", Region: "North", Revenue: 14_250.5 },
  { Active: false, Note: "ok", Region: "EMEA", Revenue: 9800 },
  { Active: true, Note: "n/a", Region: "APAC", Revenue: 5430 },
  { Active: true, Note: "good", Region: "North", Revenue: 14_250.5 },
  { Active: false, Note: "pending", Region: "LATAM", Revenue: null },
];

test.describe("column type inference", () => {
  test("recognises numbers, booleans, strings and empty columns", () => {
    expect(inferColumnType(["1", "2", "3"]).type).toBe("number");
    expect(inferColumnType(["true", "false", "yes"]).type).toBe("boolean");
    expect(inferColumnType(["a", "b", "c"]).type).toBe("string");
    expect(inferColumnType([null, "", "  "]).type).toBe("empty");
    expect(inferColumnType(["2024-01-15", "2024-02-01"]).type).toBe("date");
  });

  test("parses thousands separators and currency as numbers", () => {
    expect(inferColumnType(["9,800", "1,234.50"]).type).toBe("number");
    expect(inferColumnType(["$1,200", "$980"]).type).toBe("number");
  });

  test("does not mistake a European decimal for a thousands separator", () => {
    // "1,5" is one-and-a-half in much of the world, not fifteen hundred.
    expect(inferColumnType(["1,5", "2,5"]).type).toBe("string");
  });

  test("treats 'n/a' as a missing value rather than as text", () => {
    expect(isNullLike("n/a")).toBe(true);
    expect(isNullLike("N/A")).toBe(true);
    expect(isNullLike("#DIV/0!")).toBe(true);
    expect(isNullLike("")).toBe(true);
    expect(isNullLike("ok")).toBe(false);
  });

  test("a single 'n/a' does not demote a numeric column", () => {
    const values = SALES.map((row) => row.Revenue);
    expect(inferColumnType(values).type).toBe("number");
  });
});

test.describe("filtering", () => {
  test("compares numerically when both sides are numbers", () => {
    const filtered = filterRows(SALES, {
      column: "Revenue",
      operator: ">",
      value: 9000,
    });

    // North 14250.5, EMEA 9800, North 14250.5 — but not APAC 5430 or the blank.
    expect(filtered).toHaveLength(3);
    expect(filtered.map((row) => row.Region)).toEqual([
      "North",
      "EMEA",
      "North",
    ]);
  });

  test("a lexicographic comparison would have got this wrong", () => {
    // "9800" sorts before "14250.5" as text, so a text comparison would drop
    // EMEA from a > 9000 filter.
    const rows: SheetRow[] = [{ Revenue: 14_250.5 }, { Revenue: 9800 }];

    expect(
      filterRows(rows, { column: "Revenue", operator: ">", value: 9000 })
    ).toHaveLength(2);
  });

  test("matches a thousands-separated value against a numeric threshold", () => {
    const rows: SheetRow[] = [{ Revenue: "9,800" }, { Revenue: "1,200" }];

    const filtered = filterRows(rows, {
      column: "Revenue",
      operator: ">",
      value: 5000,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].Revenue).toBe("9,800");
  });

  test("contains is case-insensitive", () => {
    const filtered = filterRows(SALES, {
      column: "Region",
      operator: "contains",
      value: "n",
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every((row) => String(row.Region).toLowerCase().includes("n"))
    ).toBe(true);
  });

  test("empty and not_empty treat 'n/a' as empty", () => {
    const empty = filterRows(SALES, {
      column: "Note",
      operator: "empty",
    });

    expect(empty).toHaveLength(1);
    expect(empty[0].Region).toBe("APAC");
  });

  test("an unknown column leaves the rows untouched", () => {
    const filtered = filterRows(SALES, {
      column: "Nope",
      operator: "==",
      value: "x",
    });

    expect(filtered).toHaveLength(SALES.length);
  });
});

test.describe("sorting", () => {
  test("sorts numerically rather than lexicographically", () => {
    const sorted = sortRows(SALES, "Revenue", "desc");

    expect(sorted[0].Revenue).toBe(14_250.5);
    expect(sorted.at(-1)?.Revenue).toBe(null);
  });

  test("blanks always sort last, in both directions", () => {
    const ascending = sortRows(SALES, "Revenue", "asc");
    const descending = sortRows(SALES, "Revenue", "desc");

    expect(ascending.at(-1)?.Revenue).toBe(null);
    expect(descending.at(-1)?.Revenue).toBe(null);
  });
});

test.describe("deduplication", () => {
  test("removes rows that match on every column", () => {
    const result = removeDuplicateRows(SALES);

    expect(result.removed).toBe(1);
    expect(result.rows).toHaveLength(4);
  });

  test("uses only the key columns when they are given", () => {
    const rows: SheetRow[] = [
      { Email: "a@x.com", Name: "Ann" },
      { Email: "a@x.com", Name: "Anne" },
      { Email: "b@x.com", Name: "Bob" },
    ];

    const result = removeDuplicateRows(rows, ["Email"]);

    expect(result.removed).toBe(1);
    expect(result.rows).toHaveLength(2);
  });
});

test.describe("summary statistics", () => {
  test("computes count, missing values and unique counts", () => {
    const stats = computeSummaryStats(SALES, ["Region", "Revenue"]);
    const [region, revenue] = stats;

    expect(region.count).toBe(5);
    expect(region.uniqueCount).toBe(4);
    expect(region.type).toBe("string");

    expect(revenue.type).toBe("number");
    expect(revenue.count).toBe(4);
    expect(revenue.nullCount).toBe(1);
    expect(revenue.min).toBe(5430);
    expect(revenue.max).toBe(14_250.5);
  });

  test("computes a mean and a median for numeric columns", () => {
    const stats = computeSummaryStats(
      [{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }],
      ["v"]
    );

    expect(stats[0].mean).toBe(25);
    expect(stats[0].median).toBe(25);
  });

  test("returns an empty result for no columns", () => {
    expect(computeSummaryStats([], [])).toEqual([]);
  });
});

test.describe("write coercion", () => {
  test("converts thousands-separated text into a real number", () => {
    const coerced = coerceRows([{ Revenue: "9,800" }], ["Revenue"]);

    expect(coerced[0].Revenue).toBe(9800);
  });

  test("leaves identifiers with a leading zero alone", () => {
    // A zip code is not the number seven.
    const coerced = coerceRows([{ Zip: "007" }], ["Zip"]);

    expect(coerced[0].Zip).toBe("007");
  });

  test("turns blank and 'n/a' cells into null", () => {
    const coerced = coerceRows([{ A: "n/a", B: "", C: "x" }], ["A", "B", "C"]);

    expect(coerced[0].A).toBe(null);
    expect(coerced[0].B).toBe(null);
    expect(coerced[0].C).toBe("x");
  });
});

test.describe("header handling", () => {
  test("gives repeated headers distinct names", () => {
    expect(uniqueHeaders(["Date", "Date", "Amount"])).toEqual([
      "Date",
      "Date (2)",
      "Amount",
    ]);
  });

  test("names blank headers by position", () => {
    expect(uniqueHeaders(["", "Amount"])).toEqual(["Column 1", "Amount"]);
  });
});

test.describe("sheet reference envelope", () => {
  test("round-trips a reference", () => {
    const encoded = encodeSheetRef({
      filename: "sales.csv",
      format: "csv",
      rows: 120,
      storageKey: "user/chat/1-sales.csv",
    });

    const decoded = decodeSheetRef(encoded);

    expect(decoded?.storageKey).toBe("user/chat/1-sales.csv");
    expect(decoded?.rows).toBe(120);
    expect(decoded?.format).toBe("csv");
  });

  test("rejects content that is not a reference", () => {
    expect(decodeSheetRef("Region,Revenue\nNorth,1")).toBe(null);
    expect(decodeSheetRef("")).toBe(null);
    expect(decodeSheetRef(null)).toBe(null);
  });

  test("rejects a malformed envelope", () => {
    expect(decodeSheetRef("sheet-ref:{not json")).toBe(null);
    expect(decodeSheetRef("sheet-ref:{}")).toBe(null);
  });
});
