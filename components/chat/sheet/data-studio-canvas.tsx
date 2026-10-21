"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { parse, unparse } from "papaparse";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import DataGrid from "react-data-grid";
import { toast } from "sonner";

import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import {
  type CellValue,
  computeSummaryStats,
  inferColumnType,
} from "@/lib/sheet/operations";
import { toolEndpoint } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";

import "react-data-grid/lib/styles.css";

/**
 * Data Studio canvas.
 *
 * Shows a spreadsheet as a real grid: typed columns, a metrics banner, instant
 * search and sort, and exports in every supported format.
 *
 * Two rules shaped this component:
 *
 * 1. The client and the server must agree about what a column *is*. A "Revenue"
 *    column that the server called numeric but the browser called text would
 *    sort differently in the two places, and the user would see a grid that
 *    contradicts the file they downloaded. So both import the same pure module,
 *    `lib/sheet/operations`, rather than each inferring types on its own.
 * 2. The grid is a viewport, not the file. Rows are fetched in one bounded
 *    payload; the count of rows the file really has is always shown next to the
 *    count on screen, so a truncated view is never mistaken for the whole data.
 */

export interface DataStudioCanvasProps {
  /** A `sheet-ref:` envelope, or raw CSV for a model-generated sheet. */
  content: string;
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  title: string;
  totalVersions?: number;
}

type ColumnMeta = {
  name: string;
  numericRatio: number;
  type: "number" | "string" | "boolean" | "date" | "empty";
};

type SheetData = {
  activeSheet: string;
  columns: ColumnMeta[];
  format: string;
  headers: string[];
  /** Rows actually loaded into the browser. */
  rows: CellValue[][];
  sheetNames: string[];
  /** Rows the file really contains. */
  totalRows: number;
  /** Signed URL of the original file, when it lives in storage. */
  url?: string | null;
};

type GridRow = Record<string, CellValue | number> & { id: number };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_BADGE: Record<ColumnMeta["type"], string> = {
  boolean: "bool",
  date: "date",
  empty: "—",
  number: "123",
  string: "ABC",
};

/** Renders a cell value with a monospace face for numbers. */
function formatCell(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

export const DataStudioCanvas = memo(function InnerDataStudioCanvas({
  content,
  currentVersionIndex = 0,
  documentId: propDocumentId,
  handleVersionChange,
  title,
  totalVersions = 1,
}: DataStudioCanvasProps) {
  const { resolvedTheme } = useTheme();
  const { artifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);

  /**
   * The document this studio acts on.
   *
   * The prop is preferred, but the artifact store is the source of truth: the
   * panel is opened from an attachment before the prop is threaded through, and
   * "init" is the placeholder id the artifact starts with.
   */
  const documentId = useMemo(() => {
    if (propDocumentId && UUID_REGEX.test(propDocumentId)) {
      return propDocumentId;
    }

    if (
      artifact.documentId &&
      artifact.documentId !== "init" &&
      UUID_REGEX.test(artifact.documentId)
    ) {
      return artifact.documentId;
    }
  }, [artifact.documentId, propDocumentId]);

  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);

  /** Loads the sheet: from the server for a stored file, parsed locally for raw CSV. */
  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    const load = async () => {
      // The server is the single source of truth whenever a document exists: it
      // knows the storage key, the version, and the page count. The browser only
      // parses CSV itself when there is no document at all.
      if (!documentId) {
        const parsed = parse<string[]>(content, { skipEmptyLines: "greedy" });
        const rawHeaders = parsed.data[0] ?? [];
        const headers = rawHeaders.map(
          (header, index) =>
            String(header ?? "").trim() || `Column ${index + 1}`
        );
        const body = rawHeaders.length ? parsed.data.slice(1) : parsed.data;
        const rows = body.map((row) =>
          headers.map((_, index) => (row[index] ?? "") as CellValue)
        );
        const columns = headers.map((name, index) => {
          const values = rows.map((row) => row[index] ?? null);
          const { numericRatio, type } = inferColumnType(values);

          return { name, numericRatio, type };
        });

        if (!cancelled) {
          setData({
            activeSheet: "Data",
            columns,
            format: "csv",
            headers,
            rows,
            sheetNames: ["Data"],
            totalRows: rows.length,
            url: null,
          });
          setIsLoading(false);
        }

        return;
      }

      if (isGuest) {
        setIsLoading(false);
        return;
      }

      const response = await fetch(toolEndpoint("sheet"), {
        body: JSON.stringify({
          action: "resolve",
          documentId,
          params: { sheetName: activeSheetName ?? undefined },
          versionIndex: currentVersionIndex,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.status === 403) {
        setShowAuthModal(true);
        setIsLoading(false);
        return;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not open the spreadsheet.");
      }

      const { result } = payload;

      if (!cancelled) {
        setData({
          activeSheet: result.activeSheet,
          columns: result.columns,
          format: result.format,
          headers: result.headers,
          rows: result.rows,
          sheetNames: result.sheetNames,
          totalRows: result.totalRows,
          url: result.url,
        });
        setIsLoading(false);
      }
    };

    load().catch((cause: Error) => {
      if (!cancelled) {
        setError(cause.message);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSheetName, content, currentVersionIndex, documentId, isGuest]);

  /** The visible rows: searched, then sorted. */
  const visibleRows = useMemo(() => {
    if (!data) {
      return [];
    }

    const { rows: sourceRows } = data;
    let rows = sourceRows;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const columnIndex = sortColumn ? data.headers.indexOf(sortColumn) : -1;

      rows = rows.filter((row) => {
        // With a sort column chosen, the search applies to that column alone —
        // otherwise "Revenue" would match a note that happens to mention money.
        if (columnIndex >= 0) {
          return formatCell(row[columnIndex] ?? null)
            .toLowerCase()
            .includes(needle);
        }

        return row.some((cell) =>
          formatCell(cell).toLowerCase().includes(needle)
        );
      });
    }

    if (sortColumn) {
      const index = data.headers.indexOf(sortColumn);

      if (index >= 0) {
        const direction = sortDirection === "desc" ? -1 : 1;

        rows = [...rows].sort((a, b) => {
          const left = a[index] ?? null;
          const right = b[index] ?? null;

          if (left === null || left === "") {
            return 1;
          }

          if (right === null || right === "") {
            return -1;
          }

          const leftNumber = Number(left);
          const rightNumber = Number(right);

          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return (leftNumber - rightNumber) * direction;
          }

          return (
            String(left).localeCompare(String(right), undefined, {
              numeric: true,
              sensitivity: "base",
            }) * direction
          );
        });
      }
    }

    return rows;
  }, [data, search, sortColumn, sortDirection]);

  const gridRows = useMemo<GridRow[]>(
    () =>
      visibleRows.map((row, rowIndex) => {
        const gridRow: GridRow = { id: rowIndex };

        data?.headers.forEach((header, columnIndex) => {
          gridRow[header] = row[columnIndex] ?? null;
        });

        return gridRow;
      }),
    [data?.headers, visibleRows]
  );

  /** Metrics for the banner, computed with the same code the server uses. */
  const metrics = useMemo(() => {
    if (!data) {
      return null;
    }

    const rows = visibleRows.map((row) => {
      const record: Record<string, CellValue> = {};

      data.headers.forEach((header, index) => {
        record[header] = row[index] ?? null;
      });

      return record;
    });

    const stats = computeSummaryStats(rows, data.headers);
    const nullCount = stats.reduce((total, stat) => total + stat.nullCount, 0);
    const numeric = stats.find((stat) => stat.type === "number" && stat.mean);

    return {
      average: numeric ? { mean: numeric.mean, name: numeric.name } : null,
      nullCount,
      stats,
    };
  }, [data, visibleRows]);

  /** Toggles the sort on a column: ascending, then descending. */
  const toggleSort = useCallback((header: string) => {
    setSortColumn((current) => {
      if (current !== header) {
        setSortDirection("asc");
        return header;
      }

      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return current;
    });
  }, []);

  const columns = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.headers.map((header, index) => {
      const meta = data.columns[index];
      const isSorted = sortColumn === header;

      return {
        cellClass: cn("border-t dark:bg-neutral-950 dark:text-neutral-50", {
          "border-l": index !== 0,
        }),
        headerCellClass: cn(
          "border-t bg-muted/40 dark:bg-neutral-900 dark:text-neutral-50",
          { "border-l": index !== 0 }
        ),
        key: header,
        name: header,
        renderCell: ({ row }: { row: GridRow }) => {
          const value = row[header];

          return (
            <span
              className={cn(
                "block truncate font-mono text-xs",
                meta?.type === "number" && "text-right tabular-nums",
                (value === null || value === "") &&
                  "italic text-muted-foreground/50"
              )}
            >
              {value === null || value === ""
                ? "—"
                : formatCell(value as CellValue)}
            </span>
          );
        },
        // The grid has no header-click handler in this version, so the header cell
        // renders its own button.
        renderHeaderCell: () => (
          <button
            className="flex w-full cursor-pointer items-center gap-1.5 truncate text-left"
            onClick={() => toggleSort(header)}
            title={`Sort by ${header}`}
            type="button"
          >
            <span className="truncate">{header}</span>
            <span
              className="rounded bg-muted px-1 py-px font-mono text-[9px] text-muted-foreground"
              title={`Inferred type: ${meta?.type ?? "string"}`}
            >
              {TYPE_BADGE[meta?.type ?? "string"]}
            </span>
            {isSorted ? (
              sortDirection === "asc" ? (
                <ArrowUp className="size-3 shrink-0" />
              ) : (
                <ArrowDown className="size-3 shrink-0" />
              )
            ) : null}
          </button>
        ),
        width: 160,
      };
    });
  }, [data, sortColumn, sortDirection, toggleSort]);

  /** Exports the current view as CSV, entirely in the browser. */
  const exportCsv = useCallback(() => {
    if (!data) {
      return;
    }

    const csv = unparse([data.headers, ...visibleRows]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.download = `${(title || "data").replace(/\.[^.]+$/, "")}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  }, [data, title, visibleRows]);

  /** Exports the current view as JSON, in the browser. */
  const exportJson = useCallback(() => {
    if (!data) {
      return;
    }

    const payload = visibleRows.map((row) => {
      const record: Record<string, CellValue> = {};

      data.headers.forEach((header, index) => {
        record[header] = row[index] ?? null;
      });

      return record;
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.download = `${(title || "data").replace(/\.[^.]+$/, "")}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("JSON downloaded");
  }, [data, title, visibleRows]);

  /** Exports the whole file as XLSX, through the server. */
  const exportXlsx = useCallback(async () => {
    if (!documentId) {
      toast.error("XLSX export is only available for a saved spreadsheet");
      return;
    }

    setIsWorking(true);

    try {
      const response = await fetch(toolEndpoint("sheet"), {
        body: JSON.stringify({
          action: "export",
          documentId,
          params: { targetFormat: "xlsx" },
          versionIndex: currentVersionIndex,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.status === 403) {
        setShowAuthModal(true);
        return;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Export failed.");
      }

      const link = document.createElement("a");

      link.download = payload.result.filename ?? "data.xlsx";
      link.href = payload.result.url;
      link.click();
      toast.success("XLSX downloaded");
    } catch (cause: any) {
      toast.error(cause.message ?? "Export failed.");
    } finally {
      setIsWorking(false);
    }
  }, [currentVersionIndex, documentId]);

  if (isGuest && documentId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <FileSpreadsheet className="size-8 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium text-foreground">Data Studio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in to analyse, filter and convert spreadsheets.
          </p>
        </div>
        <button
          className="cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
          onClick={() => setShowAuthModal(true)}
          type="button"
        >
          Sign in
        </button>
        <GuestAuthModal
          featureName="Data Studio"
          onOpenChange={setShowAuthModal}
          open={showAuthModal}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span className="max-w-[130px] truncate text-xs font-semibold tracking-tight text-foreground sm:max-w-[200px] md:max-w-xs md:text-sm">
                {artifact.title || title || "data.csv"}
              </span>
              {totalVersions > 1 ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                  v{currentVersionIndex + 1}/{totalVersions}
                </span>
              ) : null}
            </div>
            <span className="truncate font-mono text-[10px] leading-none text-muted-foreground">
              {data
                ? `${data.totalRows.toLocaleString()} rows · ${data.headers.length} columns · ${data.format.toUpperCase()}`
                : "Loading…"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {handleVersionChange && totalVersions > 1 ? (
            <div className="flex items-center gap-0.5 pr-1">
              <button
                aria-label="Previous version"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={currentVersionIndex <= 0}
                onClick={() => handleVersionChange("prev")}
                type="button"
              >
                <ArrowUp className="size-3.5 -rotate-90" />
              </button>
              <button
                aria-label="Next version"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={currentVersionIndex >= totalVersions - 1}
                onClick={() => handleVersionChange("next")}
                type="button"
              >
                <ArrowDown className="size-3.5 -rotate-90" />
              </button>
            </div>
          ) : null}

          <button
            className="cursor-pointer rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={isWorking}
            onClick={exportCsv}
            type="button"
          >
            CSV
          </button>
          <button
            className="cursor-pointer rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={isWorking}
            onClick={exportXlsx}
            type="button"
          >
            XLSX
          </button>
          <button
            className="cursor-pointer rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={isWorking}
            onClick={exportJson}
            type="button"
          >
            JSON
          </button>
          {data?.url ? (
            <button
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                window.open(data.url ?? "", "_blank", "noopener");
              }}
              type="button"
            >
              <Download className="size-3" />
              Original
            </button>
          ) : null}
        </div>
      </div>

      {/* Metrics banner */}
      {metrics ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 bg-muted/10 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          <span>
            Rows{" "}
            <span className="text-foreground">
              {visibleRows.length.toLocaleString()}
            </span>
            {visibleRows.length === data?.totalRows ? null : (
              <span className="text-muted-foreground/70">
                {" "}
                of {data?.totalRows.toLocaleString()}
              </span>
            )}
          </span>
          <span>
            Columns{" "}
            <span className="text-foreground">{data?.headers.length}</span>
          </span>
          <span>
            Empty cells{" "}
            <span className="text-foreground">
              {metrics.nullCount.toLocaleString()}
            </span>
          </span>
          {metrics.average ? (
            <span>
              Avg {metrics.average.name}{" "}
              <span className="text-foreground">
                {metrics.average.mean?.toLocaleString()}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
          <input
            className="h-7 w-full rounded-md border border-border/60 bg-transparent pr-6 pl-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search any column…"
            type="search"
            value={search}
          />
          {search ? (
            <button
              aria-label="Clear search"
              className="absolute right-1.5 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setSearch("")}
              type="button"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>

        {data && data.sheetNames.length > 1 ? (
          <select
            className="h-7 cursor-pointer rounded-md border border-border/60 bg-transparent px-1.5 text-[11px] text-muted-foreground outline-none"
            onChange={(event) => setActiveSheetName(event.target.value)}
            value={activeSheetName ?? data.activeSheet}
          >
            {data.sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}

        {sortColumn ? (
          <button
            className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setSortColumn(null)}
            type="button"
          >
            <ArrowUpDown className="size-3" />
            {sortColumn} {sortDirection === "asc" ? "↑" : "↓"}
          </button>
        ) : null}
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <FileSpreadsheet className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{error}</p>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading spreadsheet…
          </div>
        ) : (
          <DataGrid
            className={resolvedTheme === "dark" ? "rdg-dark" : "rdg-light"}
            columns={columns}
            defaultColumnOptions={{
              resizable: true,
            }}
            headerRowHeight={34}
            rowHeight={30}
            rows={gridRows}
            style={{ height: "100%" }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <span>
          Showing {visibleRows.length.toLocaleString()} of{" "}
          {(data?.totalRows ?? 0).toLocaleString()} rows
        </span>
        <span>
          {data?.columns
            .map((column) => column.type)
            .filter((type, index, all) => all.indexOf(type) === index)
            .join(" · ") || "—"}
        </span>
      </div>

      <GuestAuthModal
        featureName="Data Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
