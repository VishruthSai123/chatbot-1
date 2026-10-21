import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { guestRegex } from "@/lib/constants";
import { getLatestDocumentByKind, isValidUUID } from "@/lib/db/queries";
import { writeSheetFile } from "@/lib/sheet/native";
import type { SheetFormat } from "@/lib/sheet/ref";
import {
  applyDedupe,
  applyFilterSort,
  applyStats,
  executeConvert,
  persistSheetBytes,
  persistSheetVersion,
  resolveSheetSource,
  selectSheet,
} from "@/lib/tools/sheet";
import type { ChatMessage } from "@/lib/types";

type SheetToolsProps = {
  session: Session;
  /** Optional: read-only tools do not need to reveal the studio. */
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  chatId?: string;
  /**
   * Spreadsheet currently open in the right-pane studio. Lets a tool act on
   * exactly what the user is looking at when the model does not name a file.
   */
  activeSheet?: {
    documentId?: string;
    versionIndex?: number;
  };
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Reveals the studio, pointed at the version a tool just wrote.
 *
 * The envelope is emitted alongside the id and title on purpose. The server has
 * already persisted the new version; without telling the client which file it
 * points at, the studio would keep drawing the previous one until the user
 * reloaded the page.
 */
function emitSheetArtifact(
  dataStream: UIMessageStreamWriter<ChatMessage> | undefined,
  payload: { content: string; id: string; title: string }
) {
  if (!dataStream) {
    return;
  }

  dataStream.write({ data: "sheet", transient: true, type: "data-kind" });
  dataStream.write({ data: payload.id, transient: true, type: "data-id" });
  dataStream.write({
    data: payload.title,
    transient: true,
    type: "data-title",
  });
  dataStream.write({
    data: payload.content,
    transient: true,
    type: "data-sheetDelta",
  });
  dataStream.write({ data: null, transient: true, type: "data-finish" });
}

/** The envelope describing a produced file. */
function sheetRefContent(payload: {
  activeSheet: string;
  columns: number;
  filename: string;
  format: string;
  rows: number;
  sheetNames: string[];
  storageKey: string;
}): string {
  return `sheet-ref:${JSON.stringify({
    activeSheet: payload.activeSheet,
    columns: payload.columns,
    filename: payload.filename,
    format: payload.format,
    rows: payload.rows,
    sheetNames: payload.sheetNames,
    storageKey: payload.storageKey,
  })}`;
}

/** Finds the spreadsheet a tool should act on. */
async function resolveDocumentId({
  activeSheet,
  documentId,
  userId,
}: {
  activeSheet?: { documentId?: string };
  documentId?: string;
  userId: string;
}): Promise<string | undefined> {
  if (documentId && isValidUUID(documentId)) {
    return documentId;
  }

  if (activeSheet?.documentId && isValidUUID(activeSheet.documentId)) {
    return activeSheet.documentId;
  }

  const latest = await getLatestDocumentByKind({ kind: "sheet", userId });

  return latest?.id;
}

async function openSheet({
  activeSheet,
  documentId,
  userId,
}: {
  activeSheet?: { documentId?: string; versionIndex?: number };
  documentId?: string;
  userId: string;
}) {
  const id = await resolveDocumentId({ activeSheet, documentId, userId });

  if (!id) {
    return null;
  }

  return await resolveSheetSource({
    documentId: id,
    userId,
    versionIndex: activeSheet?.versionIndex,
  });
}

export const sheetGetInfo = ({
  activeSheet,
  dataStream: _dataStream,
  session,
}: SheetToolsProps) =>
  tool({
    description:
      "Report a spreadsheet's row count, column count, column names and inferred column types. Use this before answering questions about what a file contains.",
    execute: async ({ documentId }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to inspect spreadsheets." };
      }

      const source = await openSheet({
        activeSheet,
        documentId,
        userId: session.user.id,
      });

      if (!source) {
        return { error: "I could not find that spreadsheet in this chat." };
      }

      const sheet = selectSheet(source);

      return {
        columns: sheet.headers,
        documentId: source.documentId,
        rows: sheet.rows.length,
        sheetNames: source.sheets.map((entry) => entry.name),
        title: source.title,
      };
    },
    inputSchema: z.object({
      documentId: z
        .string()
        .optional()
        .describe(
          "Document id from an attachment. Omit to use the spreadsheet open in the studio."
        ),
    }),
  });

export const sheetFilterSort = ({
  activeSheet,
  chatId,
  dataStream,
  session,
}: SheetToolsProps) =>
  tool({
    description:
      "Filter rows by a column condition and/or sort rows by a column. The result replaces the spreadsheet as a new version, so the user can undo it.",
    execute: async ({
      documentId,
      filterColumn,
      filterOperator,
      filterValue,
      sortColumn,
      sortOrder,
      title,
    }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to filter spreadsheets." };
      }

      const userId = session.user.id;
      const source = await openSheet({ activeSheet, documentId, userId });

      if (!source) {
        return { error: "I could not find that spreadsheet in this chat." };
      }

      if (!(filterColumn || sortColumn)) {
        return {
          error:
            "Nothing to do: name a column to filter on, a column to sort by, or both.",
        };
      }

      const applied = applyFilterSort(source.sheets, {
        filterColumn,
        filterOperator,
        filterValue,
        sortColumn,
        sortOrder,
      });
      const format: SheetFormat = source.format === "xlsx" ? "xlsx" : "csv";
      const bytes = await writeSheetFile(applied.sheets, format);
      const payload = await persistSheetBytes({
        bytes,
        chatId,
        filename: source.filename,
        format,
        sheets: applied.sheets,
        userId,
      });
      const nextTitle = title || source.title;
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload,
        title: nextTitle,
        userId,
      });

      if (nextId) {
        emitSheetArtifact(dataStream, {
          content: sheetRefContent(payload),
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        after: applied.after,
        before: applied.before,
        documentId: source.documentId,
        removed: applied.before - applied.after,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      filterColumn: z.string().optional().describe("Column to filter on."),
      filterOperator: z
        .enum([
          "==",
          "!=",
          ">",
          "<",
          ">=",
          "<=",
          "contains",
          "not_contains",
          "starts_with",
          "ends_with",
          "empty",
          "not_empty",
        ])
        .optional()
        .describe('Comparison to apply, e.g. ">", "contains", "==".'),
      filterValue: z
        .union([z.string(), z.number(), z.boolean()])
        .optional()
        .describe("Value to compare the column against."),
      sortColumn: z.string().optional().describe("Column to sort by."),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      title: z.string().max(120).optional(),
    }),
  });

export const sheetRemoveDuplicates = ({
  activeSheet,
  chatId,
  dataStream,
  session,
}: SheetToolsProps) =>
  tool({
    description:
      "Remove duplicate rows. By default the whole row must match; pass keyColumns to treat rows sharing those column values as duplicates.",
    execute: async ({ documentId, keyColumns, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to clean spreadsheets." };
      }

      const userId = session.user.id;
      const source = await openSheet({ activeSheet, documentId, userId });

      if (!source) {
        return { error: "I could not find that spreadsheet in this chat." };
      }

      const applied = applyDedupe(source.sheets, { keyColumns });
      const format: SheetFormat = source.format === "xlsx" ? "xlsx" : "csv";
      const bytes = await writeSheetFile(applied.sheets, format);
      const payload = await persistSheetBytes({
        bytes,
        chatId,
        filename: source.filename,
        format,
        sheets: applied.sheets,
        userId,
      });
      const nextTitle = title || source.title;
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload,
        title: nextTitle,
        userId,
      });

      if (nextId) {
        emitSheetArtifact(dataStream, {
          content: sheetRefContent(payload),
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        after: applied.after,
        before: applied.before,
        documentId: source.documentId,
        removed: applied.removed,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      keyColumns: z
        .array(z.string())
        .optional()
        .describe(
          "Columns that together identify a duplicate. Omit to compare whole rows."
        ),
      title: z.string().max(120).optional(),
    }),
  });

export const sheetSummaryStats = ({ activeSheet, session }: SheetToolsProps) =>
  tool({
    description:
      "Compute per-column summary statistics: count, missing values, unique count, and for numeric columns the mean, median, minimum and maximum.",
    execute: async ({ columns, documentId }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to analyse spreadsheets." };
      }

      const source = await openSheet({
        activeSheet,
        documentId,
        userId: session.user.id,
      });

      if (!source) {
        return { error: "I could not find that spreadsheet in this chat." };
      }

      const stats = applyStats(source, { columns });

      return {
        documentId: source.documentId,
        stats,
        totalRows: selectSheet(source).rows.length,
      };
    },
    inputSchema: z.object({
      columns: z
        .array(z.string())
        .optional()
        .describe("Columns to summarise. Omit for every column."),
      documentId: z.string().optional(),
    }),
  });

export const sheetConvertFormat = ({
  activeSheet,
  chatId,
  dataStream,
  session,
}: SheetToolsProps) =>
  tool({
    description:
      "Convert a spreadsheet between CSV, TSV, XLSX and JSON. The converted file becomes the new version, and remains downloadable.",
    execute: async ({ documentId, targetFormat, title }) => {
      if (checkIsGuest(session)) {
        return { error: "Sign in to convert spreadsheets." };
      }

      const userId = session.user.id;
      const source = await openSheet({ activeSheet, documentId, userId });

      if (!source) {
        return { error: "I could not find that spreadsheet in this chat." };
      }

      const { result } = await executeConvert({
        context: { chatId, userId },
        params: { targetFormat },
        source,
      });
      const nextTitle = title || source.title;
      const nextId = await persistSheetVersion({
        documentId: source.documentId,
        payload: result,
        title: nextTitle,
        userId,
      });

      if (nextId) {
        emitSheetArtifact(dataStream, {
          content: sheetRefContent(result),
          id: source.documentId,
          title: nextTitle,
        });
      }

      return {
        documentId: source.documentId,
        filename: result.filename,
        format: result.format,
        rows: result.rows,
      };
    },
    inputSchema: z.object({
      documentId: z.string().optional(),
      targetFormat: z
        .enum(["csv", "tsv", "xlsx", "json"])
        .describe("Format to write the result in."),
      title: z.string().max(120).optional(),
    }),
  });
