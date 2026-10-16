# Family 03: Data & Spreadsheet Studio Rulebook

## 1. Family Scope & Core Philosophy
The Data & Spreadsheet Studio family provides tabular file parsing, row/column transformation, deduplication, summary statistics, and visualization without external cloud compute or ETL subscriptions.

### Native Stack
- **Server CSV Engine**: `papaparse` (high-speed streaming CSV/TSV parser & serializer).
- **Server XLSX Engine**: `xlsx` (SheetJS) / `exceljs` (multi-sheet workbook reader & writer).
- **Client Studio Canvas**: `react-data-grid` (virtualized DOM rendering supporting 50,000+ rows smoothly).
- **Storage**: Supabase Storage (`artifacts` private bucket).

---

## 2. Active Tools Specification

### 2.1 `sheet_filter_sort` (Filtering and Sorting)
Filters tabular rows matching target column predicates and sorts by specified column order.

#### Native Implementation:
```typescript
import { parse, unparse } from "papaparse";

export type FilterOperator = "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains";

export function filterAndSortCsv({
  csvContent,
  filterColumn,
  operator,
  filterValue,
  sortColumn,
  sortOrder = "asc",
}: {
  csvContent: string;
  filterColumn?: string;
  operator?: FilterOperator;
  filterValue?: string | number;
  sortColumn?: string;
  sortOrder?: "asc" | "desc";
}): string {
  const { data, meta } = parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  let rows = data;

  // 1. Filter predicate
  if (filterColumn && operator && filterValue !== undefined) {
    rows = rows.filter((row) => {
      const cellVal = row[filterColumn];
      if (cellVal === undefined) return false;

      const numCell = Number(cellVal);
      const numFilter = Number(filterValue);
      const isNum = !isNaN(numCell) && !isNaN(numFilter);

      switch (operator) {
        case "==": return isNum ? numCell === numFilter : cellVal === String(filterValue);
        case "!=": return isNum ? numCell !== numFilter : cellVal !== String(filterValue);
        case ">":  return isNum ? numCell > numFilter : cellVal > String(filterValue);
        case "<":  return isNum ? numCell < numFilter : cellVal < String(filterValue);
        case ">=": return isNum ? numCell >= numFilter : cellVal >= String(filterValue);
        case "<=": return isNum ? numCell <= numFilter : cellVal <= String(filterValue);
        case "contains": return String(cellVal).toLowerCase().includes(String(filterValue).toLowerCase());
        default: return true;
      }
    });
  }

  // 2. Sort order
  if (sortColumn) {
    rows.sort((a, b) => {
      const valA = a[sortColumn] ?? "";
      const valB = b[sortColumn] ?? "";
      const numA = Number(valA);
      const numB = Number(valB);

      if (!isNaN(numA) && !isNaN(numB)) {
        return sortOrder === "asc" ? numA - numB : numB - numA;
      }
      return sortOrder === "asc"
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }

  return unparse(rows, { columns: meta.fields });
}
```

---

### 2.2 `sheet_remove_duplicates` & `sheet_summary_stats`
- `sheet_remove_duplicates`: Deduplicates rows based on selected key columns or entire row fingerprints.
- `sheet_summary_stats`: Calculates summary metrics across columns (count, mean, median, min, max, nulls, unique count).

#### Native Summary Statistics Calculation:
```typescript
export interface ColumnStats {
  name: string;
  type: "number" | "string" | "date" | "boolean";
  count: number;
  nullCount: number;
  uniqueCount: number;
  mean?: number;
  min?: number | string;
  max?: number | string;
}

export function computeSummaryStats(rows: Record<string, any>[]): ColumnStats[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);

  return columns.map((col) => {
    const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
    const nullCount = rows.length - values.length;
    const uniqueCount = new Set(values).size;

    const numericValues = values.map(Number).filter((v) => !isNaN(v));
    const isNumeric = numericValues.length > values.length * 0.8; // 80% threshold

    if (isNumeric && numericValues.length > 0) {
      const sum = numericValues.reduce((acc, curr) => acc + curr, 0);
      const mean = sum / numericValues.length;
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);

      return {
        name: col,
        type: "number",
        count: values.length,
        nullCount,
        uniqueCount,
        mean: Number(mean.toFixed(2)),
        min,
        max,
      };
    }

    return {
      name: col,
      type: "string",
      count: values.length,
      nullCount,
      uniqueCount,
    };
  });
}
```

---

### 2.3 `sheet_convert_format`
Converts seamlessly between CSV, TSV, XLSX, and JSON table formats using native `papaparse` and `xlsx`.

```typescript
import { parse, unparse } from "papaparse";
import * as XLSX from "xlsx";

export function convertSpreadsheet({
  inputBuffer,
  sourceFormat,
  targetFormat,
}: {
  inputBuffer: Buffer;
  sourceFormat: "csv" | "xlsx";
  targetFormat: "csv" | "xlsx" | "json";
}): Buffer {
  let jsonData: any[] = [];

  if (sourceFormat === "xlsx") {
    const workbook = XLSX.read(inputBuffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]);
  } else {
    const parsed = parse(inputBuffer.toString("utf-8"), { header: true, skipEmptyLines: true });
    jsonData = parsed.data;
  }

  if (targetFormat === "json") {
    return Buffer.from(JSON.stringify(jsonData, null, 2));
  }

  if (targetFormat === "csv") {
    const csv = unparse(jsonData);
    return Buffer.from(csv, "utf-8");
  }

  if (targetFormat === "xlsx") {
    const worksheet = XLSX.utils.json_to_sheet(jsonData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  throw new Error(`Unsupported target format: ${targetFormat}`);
}
```

---

## 3. Dynamic Right Pane: Data Studio Canvas (`artifacts/sheet/client.tsx`)

The Right Pane dynamically mounts `<DataStudioCanvas />` when an artifact has `kind: 'sheet'`:

```
+---------------------------------------------------------------------------------------------------+
| Dynamic Data Studio Canvas                                                                        |
+---------------------------------------------------------------------------------------------------+
| Metrics Summary: [Rows: 1,420] [Cols: 8] [Null Cells: 12] [Avg Revenue: $4,520] [Export: CSV/XLSX] |
+---------------------------------------------------------------------------------------------------+
| Filter: [Search any column... 🔍]  | Sort by: [Revenue ▼]                                         |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    Virtualized Table Grid (react-data-grid):                                                      |
|    ┌──────────┬──────────────────┬──────────────┬──────────────┬──────────────┐                   |
|    │ ID #     │ Customer Name    │ Region       │ Orders (123) │ Revenue ($)  │                   |
|    ├──────────┼──────────────────┼──────────────┼──────────────┼──────────────┤                   |
|    │ 1001     │ Acme Corp        │ North America│ 45           │ $14,250.00   │                   |
|    │ 1002     │ Globex Inc       │ EMEA         │ 32           │ $9,800.00    │                   |
|    │ 1003     │ Initech Systems  │ APAC         │ 18           │ $5,430.00    │                   |
|    │ 1004     │ Umbrella LLC     │ LATAM        │ 12           │ $3,120.00    │                   |
|    └──────────┴──────────────────┴──────────────┴──────────────┴──────────────┘                   |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
| Showing 1,420 rows | Memory: 420 KB | Type Detection: All headers inferred                        |
+---------------------------------------------------------------------------------------------------+
```

### Key UI Features:
1. **Interactive Column Sorting**: Click column header to toggle ascending/descending.
2. **Column Search & Filtering**: Type to filter rows matching column values in real time.
3. **Type Badges**: Displays inferred type (`123` number, `ABC` string, `📅` date).
4. **Summary Metrics Banner**: Top cards showing row counts, missing null counts, and averages.
5. **Direct Download**: Instant export to CSV, XLSX, or JSON.
