# Family 02: PDF Studio & Document Manipulation Rulebook

## 1. Family Scope & Core Philosophy
The PDF Studio family handles document assembly, page-level manipulation, text extraction, and optimization. 

### Native Stack
- **Server Engine**: `pdf-lib` (pure JavaScript/TypeScript, zero native C++ binaries, zero external API costs; executes safely in any Node.js / Serverless environment).
- **Text Extraction**: `pdf-parse` (streaming text and font structure extraction).
- **Client Studio Canvas**: `pdfjs-dist` (client-side PDF rendering for visual page thumbnails and full-page high-resolution reading).
- **Storage**: Supabase Storage (`artifacts` private bucket).

---

## 2. Active Tools Specification

### 2.1 `pdf_merge` (Document Assembly)
Combines two or more PDF artifacts into a single unified PDF document.

#### Native Implementation:
```typescript
import { PDFDocument } from "pdf-lib";

export async function mergePdfs({
  pdfBuffers,
}: {
  pdfBuffers: Buffer[];
}): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const srcDoc = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(
      srcDoc,
      srcDoc.getPageIndices()
    );
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}
```

---

### 2.2 `pdf_split` (Page Extraction & Range Splitting)
Extracts specific page ranges (e.g., `"1-3, 5, 8-10"`) from a source PDF into a new PDF document.

#### Native Implementation:
```typescript
import { PDFDocument } from "pdf-lib";

export function parsePageRanges(rangeStr: string, totalPages: number): number[] {
  const pages = new Set<number>();
  const parts = rangeStr.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= totalPages) pages.add(i - 1); // 0-based
      }
    } else {
      const pageNum = Number(part);
      if (pageNum >= 1 && pageNum <= totalPages) pages.add(pageNum - 1);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

export async function splitPdf({
  pdfBuffer,
  pageRanges,
}: {
  pdfBuffer: Buffer;
  pageRanges: string;
}): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();
  const pageIndicesToKeep = parsePageRanges(pageRanges, totalPages);

  const destDoc = await PDFDocument.create();
  const copiedPages = await destDoc.copyPages(srcDoc, pageIndicesToKeep);
  copiedPages.forEach((page) => destDoc.addPage(page));

  const outputBytes = await destDoc.save();
  return Buffer.from(outputBytes);
}
```

---

### 2.3 `pdf_reorder_pages` & `pdf_rotate_pages`
- `pdf_reorder_pages`: Accepts an array of 1-based page indices (e.g. `[3, 1, 2, 4]`) and constructs a new PDF with the exact requested order.
- `pdf_rotate_pages`: Rotates target pages (`"all"` or `[1, 3]`) by degrees ($90^\circ, 180^\circ, 270^\circ$).

#### Native Reorder & Rotation:
```typescript
import { degrees, PDFDocument } from "pdf-lib";

export async function reorderAndRotatePdf({
  pdfBuffer,
  pageOrder, // 1-based index array
  rotations, // map: { [pageIndex: number]: 90 | 180 | 270 }
}: {
  pdfBuffer: Buffer;
  pageOrder?: number[];
  rotations?: Record<number, number>;
}): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const destDoc = await PDFDocument.create();

  const indices = pageOrder
    ? pageOrder.map((p) => p - 1)
    : srcDoc.getPageIndices();

  const copiedPages = await destDoc.copyPages(srcDoc, indices);

  copiedPages.forEach((page, i) => {
    const pageNum = indices[i] + 1;
    if (rotations && rotations[pageNum]) {
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + rotations[pageNum]));
    }
    destDoc.addPage(page);
  });

  return Buffer.from(await destDoc.save());
}
```

---

### 2.4 Other PDF Operations
- `pdf_extract_text`: Extracts structured plain text from PDF pages using `pdf-parse`.
- `pdf_compress`: Optimizes object streams and removes unused cross-reference entries.
- `pdf_extract_images`: Extracts embedded JPEG/PNG image streams into individual image artifacts.
- `pdf_get_metadata`: Returns page count, title, author, version, and encryption status.

---

## 3. Dynamic Right Pane: PDF Studio Canvas (`artifacts/pdf/client.tsx`)

The Right Pane dynamically mounts `<PdfStudioCanvas />` when an artifact has `kind: 'pdf'`:

```
+---------------------------------------------------------------------------------------------------+
| Dynamic PDF Studio Canvas                                                                         |
+---------------------------------------------------------------------------------------------------+
| [Toolbar: Split Range: [ 1-3, 5 ] | Rotate All | Extract Pages | Save Order | Download PDF]       |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    Page Thumbnail Grid (Drag-and-Drop to Reorder):                                                |
|                                                                                                   |
|    +----------------+    +----------------+    +----------------+    +----------------+           |
|    |  [Page 1]      |    |  [Page 2]      |    |  [Page 3]      |    |  [Page 4]      |           |
|    |  ┌──────────┐  |    |  ┌──────────┐  |    |  ┌──────────┐  |    |  ┌──────────┐  |           |
|    |  │ Doc Title│  |    |  │ Table    │  |    |  │ Diagram │  |    |  │ Notes    │  |           |
|    |  │          │  |    |  │          │  |    |  │          │  |    |  │          │  |           |
|    |  └──────────┘  |    |  └──────────┘  |    |  └──────────┘  |    |  └──────────┘  |           |
|    |  [↻ 90°] [✕]   |    |  [↻ 90°] [✕]   |    |  [↻ 90°] [✕]   |    |  [↻ 90°] [✕]   |           |
|    +----------------+    +----------------+    +----------------+    +----------------+           |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
| Document: contract_signed.pdf | Pages: 4 | Size: 1.2 MB | Selection: Pages 1, 2                   |
+---------------------------------------------------------------------------------------------------+
```

### Key UI Features:
1. **Visual Page Grid**: Client-side rendering of page thumbnails using `pdfjs-dist`.
2. **Drag-and-Drop Reordering**: Direct visual drag-and-drop to re-sequence pages; enables instant "Save Reordered PDF".
3. **Per-Page Quick Actions**: Hover controls on each thumbnail to rotate $90^\circ$ clockwise or mark for deletion.
4. **Visual Range Selector**: Click thumbnails to select individual or multi-page ranges for extraction.
5. **High-Resolution Full Reader**: Click to zoom into full document inspection view.

---

## 4. End-to-End Wiring: Step-by-Step

### Step 1: User Request
- User attaches two PDFs in chat and prompts: *"Merge these two documents, but rotate page 2 of the second document by 90 degrees."*

### Step 2: Gemini Tool Planning
- Gemini planner identifies the operations and emits a structured two-step task:
  1. `pdf_rotate_pages({ artifactId: "pdf_b", pages: [2], rotation: 90 })`
  2. `pdf_merge({ artifactIds: ["pdf_a", "pdf_b_rotated"], outputFilename: "merged_contract.pdf" })`

### Step 3: Backend Execution & Lineage
- Downloads input artifacts from Supabase Storage.
- Runs `reorderAndRotatePdf` and `mergePdfs` in-memory.
- Saves `merged_contract.pdf` into Supabase Storage.
- Creates `Artifact` record with both parents logged in metadata lineage.

### Step 4: UI Studio Mount
- Right Pane automatically opens `<PdfStudioCanvas />` showing all pages of `merged_contract.pdf` in the thumbnail grid.
