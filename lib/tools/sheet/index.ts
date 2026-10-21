import "server-only";

import {
  getDocumentById,
  getDocumentsById,
  isValidUUID,
  saveDocument,
} from "@/lib/db/queries";
import {
  describeSheet,
  type LoadedSheet,
  readSheetFile,
  sliceRows,
  writeSheetFile,
} from "@/lib/sheet/native";
import {
  type CellValue,
  computeSummaryStats,
  filterRows,
  removeDuplicateRows,
  type SheetRow,
  sortRows,
} from "@/lib/sheet/operations";
import {
  decodeSheetRef,
  encodeSheetRef,
  type SheetFormat,
} from "@/lib/sheet/ref";
import {
  downloadArtifact,
  getArtifactSignedUrl,
  uploadArtifact,
} from "@/lib/storage";
import { safeStorageFilename } from "@/lib/storage/limits";
import type {
  ConvertInput,
  DedupeInput,
  FilterSortInput,
  RowsInput,
  SheetOperationPayload,
  StatsInput,
} from "./types";

/** Preview links are short-lived; the studio re-signs whenever it remounts. */
export const SHEET_URL_TTL_SECONDS = 60 * 60;

export type SheetContext = {
  chatId?: string;
  documentId?: string;
  userId: string;
};

export type ResolvedSheetSource = {
  documentId: string;
  filename: string;
  format: SheetFormat;
  sheets: LoadedSheet[];
  storageKey?: string;
  title: string;
};

/**
 * Resolves which spreadsheet an operation should read.
 *
 * A version arrives in one of two shapes:
 *
 * - a `sheet-ref:` envelope, which points at a file in storage (an upload, or
 *   the product of an earlier operation);
 * - raw CSV text, which is what the model writes when it generates a sheet.
 *
 * Both are supported so the model-generated flow and the file-based flow share
 * one implementation. Ownership is enforced on every branch.
 */
export async function resolveSheetSource({
  documentId,
  userId,
  versionIndex,
}: {
  documentId?: string;
  userId: string;
  versionIndex?: number;
}): Promise<ResolvedSheetSource | null> {
  if (!(documentId && isValidUUID(documentId))) {
    return null;
  }

  const fromContent = async (
    content: string | null,
    id: string,
    title: string
  ): Promise<ResolvedSheetSource | null> => {
    if (!content) {
      return null;
    }

    const ref = decodeSheetRef(content);

    if (ref?.storageKey) {
      const buffer = await downloadArtifact(ref.storageKey);
      const workbook = await readSheetFile(buffer, ref.filename ?? title);

      return {
        documentId: id,
        filename: ref.filename ?? safeStorageFilename(title || "data.csv"),
        format: workbook.format,
        sheets: workbook.sheets,
        storageKey: ref.storageKey,
        title: title || "Data",
      };
    }

    // Raw CSV: the model wrote it straight into `Document.content`.
    const trimmed = content.trim();

    if (!trimmed || trimmed.length > 64 * 1024 * 1024) {
      return null;
    }

    const workbook = await readSheetFile(
      Buffer.from(trimmed, "utf8"),
      title || "data.csv"
    );

    return {
      documentId: id,
      filename: safeStorageFilename(title || "data.csv"),
      format: workbook.format,
      sheets: workbook.sheets,
      title: title || "Data",
    };
  };

  if (typeof versionIndex === "number" && versionIndex >= 0) {
    try {
      const versions = await getDocumentsById({ id: documentId });
      const requested = versions[versionIndex];

      if (requested?.userId === userId) {
        const resolved = await fromContent(
          requested.content,
          requested.id,
          requested.title
        );

        if (resolved) {
          return resolved;
        }
      }
    } catch (error) {
      console.warn("Non-fatal: failed to resolve sheet version:", error);
    }
  }

  try {
    const doc = await getDocumentById({ id: documentId });

    if (doc?.userId === userId) {
      return await fromContent(doc.content, doc.id, doc.title);
    }
  } catch (error) {
    console.warn("Non-fatal: sheet document lookup failed:", error);
  }

  return null;
}

/** Picks a sheet by name, falling back to the first one. */
export function selectSheet(
  workbook: { sheets: LoadedSheet[] },
  sheetName?: string
): LoadedSheet {
  return (
    workbook.sheets.find((sheet) => sheet.name === sheetName) ??
    workbook.sheets[0]
  );
}

/** Uploads produced bytes and returns everything the studio needs to show them. */
export async function persistSheetBytes({
  bytes,
  chatId,
  filename,
  format,
  sheets,
  userId,
}: {
  bytes: Buffer;
  chatId?: string;
  filename: string;
  format: SheetFormat;
  sheets: LoadedSheet[];
  userId: string;
}): Promise<SheetOperationPayload> {
  const uploaded = await uploadArtifact({
    chatId,
    contentType:
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "json"
          ? "application/json"
          : "text/csv",
    fileBuffer: bytes,
    filename,
    userId,
  });

  return {
    activeSheet: sheets[0]?.name ?? "Data",
    columns: sheets[0]?.headers.length ?? 0,
    filename: uploaded.pathname,
    format,
    rows: sheets[0]?.rows.length ?? 0,
    sheetNames: sheets.map((sheet) => sheet.name),
    sizeBytes: uploaded.size,
    storageKey: uploaded.storageKey,
    url: await getArtifactSignedUrl(uploaded.storageKey, SHEET_URL_TTL_SECONDS),
  };
}

/** Writes a new document version pointing at the produced file. */
export async function persistSheetVersion({
  documentId,
  payload,
  title,
  userId,
}: {
  documentId?: string;
  payload: SheetOperationPayload;
  title: string;
  userId: string;
}): Promise<string | undefined> {
  try {
    const saved = await saveDocument({
      content: encodeSheetRef({
        activeSheet: payload.activeSheet,
        columns: payload.columns,
        filename: payload.filename,
        format: payload.format,
        rows: payload.rows,
        sheetNames: payload.sheetNames,
        sizeBytes: payload.sizeBytes,
        storageKey: payload.storageKey,
      }),
      id: documentId ?? crypto.randomUUID(),
      kind: "sheet",
      title,
      userId,
    });

    return saved?.[0]?.id ?? documentId;
  } catch (error) {
    // The file is stored and downloadable even if the row fails, so this must not
    // turn a successful operation into an error.
    console.warn("Non-fatal: failed to persist sheet version:", error);
  }
}

/** Builds the payload the studio needs to draw a sheet. */
export async function describeSheetSource(
  source: ResolvedSheetSource,
  sheetName?: string
) {
  const sheet = selectSheet(source, sheetName);
  const description = describeSheet(sheet);

  return {
    ...description,
    activeSheet: sheet.name,
    format: source.format,
    rows: sliceRows(sheet, 0, 200),
    sheetNames: source.sheets.map((entry) => entry.name),
    storageKey: source.storageKey,
    url: source.storageKey
      ? await getArtifactSignedUrl(source.storageKey, SHEET_URL_TTL_SECONDS)
      : null,
  };
}

/** Returns a window of rows for the virtualised grid. */
export function readSheetRows(
  source: ResolvedSheetSource,
  { limit, offset, sheetName }: RowsInput
) {
  const sheet = selectSheet(source, sheetName);

  return {
    activeSheet: sheet.name,
    headers: sheet.headers,
    rows: sliceRows(sheet, offset ?? 0, limit ?? 200),
    totalColumns: sheet.headers.length,
    totalRows: sheet.rows.length,
  };
}

/** Applies a filter and/or a sort, returning the affected sheets. */
export function applyFilterSort(
  sheets: LoadedSheet[],
  params: FilterSortInput
): { before: number; after: number; sheets: LoadedSheet[] } {
  const before = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);

  const next = sheets.map((sheet) => {
    const { rows: sourceRows } = sheet;
    let rows = sourceRows;

    if (params.filterColumn && params.filterOperator) {
      rows = filterRows(rows, {
        column: params.filterColumn,
        operator: params.filterOperator,
        value: params.filterValue as CellValue | undefined,
      });
    }

    if (params.sortColumn) {
      rows = sortRows(rows, params.sortColumn, params.sortOrder ?? "asc");
    }

    return { ...sheet, rows };
  });

  const after = next.reduce((total, sheet) => total + sheet.rows.length, 0);

  return { after, before, sheets: next };
}

/** Removes duplicate rows. */
export function applyDedupe(
  sheets: LoadedSheet[],
  params: DedupeInput
): { after: number; before: number; removed: number; sheets: LoadedSheet[] } {
  const before = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  let removed = 0;

  const next = sheets.map((sheet) => {
    const result = removeDuplicateRows(sheet.rows, params.keyColumns);
    removed += result.removed;

    return { ...sheet, rows: result.rows };
  });

  const after = next.reduce((total, sheet) => total + sheet.rows.length, 0);

  return { after, before, removed, sheets: next };
}

/** Computes summary statistics for the active sheet. */
export function applyStats(
  source: ResolvedSheetSource,
  params: StatsInput,
  sheetName?: string
) {
  const sheet = selectSheet(source, sheetName);
  const headers = params.columns?.length ? params.columns : sheet.headers;
  const rows: SheetRow[] = sheet.rows;

  return computeSummaryStats(rows, headers);
}

/** Converts the workbook into another format and stores the result. */
export async function executeConvert({
  context,
  params,
  source,
}: {
  context: SheetContext;
  params: ConvertInput;
  source: ResolvedSheetSource;
}): Promise<{ result: SheetOperationPayload }> {
  const targetFormat = params.targetFormat as SheetFormat;
  const bytes = await writeSheetFile(source.sheets, targetFormat);
  const filename = `${(source.filename || "data").replace(/\.[^.]+$/, "")}.${targetFormat}`;

  return {
    result: await persistSheetBytes({
      bytes,
      chatId: context.chatId,
      filename,
      format: targetFormat,
      sheets: source.sheets,
      userId: context.userId,
    }),
  };
}
