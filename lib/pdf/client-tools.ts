"use client";

import { parseSplitGroups } from "@/lib/pdf/pages";
import { toolEndpoint } from "@/lib/tools/endpoint";

const PDF_TOOL_ENDPOINT = toolEndpoint("pdf");

/**
 * Browser PDF work, kept symmetrical with the image client engine.
 *
 * Splitting is page arithmetic plus a re-serialisation: no rendering, no OCR,
 * no fonts to resolve. That makes it a pure CPU win to run it here — the server
 * only stores the bytes and mints URLs. Merge stays server-side because it is
 * invoked by the model tool from chat, with no browser surface to hook into.
 */

export function clientPdfToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLIENT_PDF_TOOLS === "true";
}

export type ClientPdfPart = {
  base64: string;
  filename: string;
  pages: number;
};

/**
 * Vercel rejects bodies over 4.5 MB. Leave headroom for the JSON envelope and
 * fall back to the server when the parts would not fit.
 */
const MAX_BASE64_CHARS = 4_000_000;

/**
 * Splits a PDF into one file per `;`-separated range group.
 *
 * Returns null for anything the browser should not own: encrypted PDFs (pdf-lib
 * cannot decrypt), cross-origin failures, unsupported syntax and parts too large
 * to upload. The caller then uses the server action, so this stays an
 * optimisation rather than a new failure mode.
 */
export async function splitPdfInBrowser({
  url,
  pageRanges,
}: {
  url: string;
  pageRanges?: string;
}): Promise<ClientPdfPart[] | null> {
  if (!clientPdfToolsEnabled()) {
    return null;
  }

  try {
    // `cache: "reload"` avoids reusing a no-CORS response cached by an <embed>
    // or earlier download, the same trap the image client engine hit with R2.
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) {
      return null;
    }

    const sourceBytes = await response.arrayBuffer();
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    if (source.isEncrypted) {
      return null;
    }

    const groups = parseSplitGroups(pageRanges, source.getPageCount());
    if (groups.length === 0) {
      return null;
    }

    const parts: ClientPdfPart[] = [];
    let totalChars = 0;

    for (const group of groups) {
      // biome-ignore lint/performance/noAwaitInLoops: copyPages mutates the source document index, so parts must be serialized.
      const output = await PDFDocument.create();
      const copied = await output.copyPages(
        source,
        group.map((page) => page - 1)
      );

      for (const page of copied) {
        output.addPage(page);
      }

      const saved = await output.save({ useObjectStreams: true });
      const base64 = bytesToBase64(saved);
      totalChars += base64.length;

      if (totalChars > MAX_BASE64_CHARS) {
        return null;
      }

      parts.push({
        base64,
        filename:
          groups.length === 1
            ? "split.pdf"
            : `split-${parts.length + 1}of${groups.length}.pdf`,
        pages: group.length,
      });
    }

    return parts.length > 0 ? parts : null;
  } catch {
    return null;
  }
}

/**
 * Stores browser-produced parts and promotes the first one to the live version.
 * Returns null on any failure so the caller can retry through the server.
 */
export async function persistClientPdfParts({
  documentId,
  parts,
  title,
}: {
  documentId?: string;
  parts: ClientPdfPart[];
  title?: string;
}): Promise<{
  documentId?: string;
  result?: { filename: string; pages: number; url: string };
  results?: Array<{ filename: string; pages: number; url: string }>;
} | null> {
  try {
    const response = await fetch(PDF_TOOL_ENDPOINT, {
      body: JSON.stringify({
        action: "persist_split",
        documentId,
        params: { parts },
        title,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result ? data : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x80_00;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}
