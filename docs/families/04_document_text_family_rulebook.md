# Family 04: Document & Text Studio Rulebook

## 1. Family Scope & Core Philosophy
The Document & Text Studio family provides document parsing, structured text extraction, side-by-side diff comparison, and AI semantic summarization without third-party document transformation APIs.

### Native Stack
- **Server DOCX Parser**: `mammoth` (native Node.js library converting `.docx` to semantic HTML / Markdown).
- **Server Diff Engine**: `diff-match-patch` (native algorithmic Myers-diff for character, word, and line comparisons).
- **Client Document Studio**: Rich text renderer with code highlighting (`shiki`), side-by-side diff view, and reading statistics.
- **AI Semantic Engine**: Google Gemini 2.5 Flash / Pro (used strictly for semantic summarization and text synthesis).

---

## 2. Active Tools Specification

### 2.1 `doc_extract_text` (DOCX & Document Text Extraction)
Extracts clean, structured text and Markdown from uploaded `.docx` or text files natively.

#### Native Implementation:
```typescript
import mammoth from "mammoth";

export async function extractTextFromDocx({
  docxBuffer,
}: {
  docxBuffer: Buffer;
}): Promise<{ markdown: string; rawText: string }> {
  // Extract raw text
  const rawTextResult = await mammoth.extractRawText({ buffer: docxBuffer });

  // Convert to clean HTML then format as structured text/markdown
  const htmlResult = await mammoth.convertToHtml({ buffer: docxBuffer });

  return {
    rawText: rawTextResult.value,
    markdown: htmlResult.value
      .replace(/<h1>(.*?)<\/h1>/g, "# $1\n\n")
      .replace(/<h2>(.*?)<\/h2>/g, "## $1\n\n")
      .replace(/<h3>(.*?)<\/h3>/g, "### $1\n\n")
      .replace(/<p>(.*?)<\/p>/g, "$1\n\n")
      .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
      .replace(/<em>(.*?)<\/em>/g, "*$1*"),
  };
}
```

---

### 2.2 `doc_compare_diff` (Visual & Line-by-Line Diff)
Compares two documents or versions algorithmically and produces an inline/side-by-side diff structure.

#### Native Implementation:
```typescript
import DiffMatchPatch from "diff-match-patch";

export interface DiffSegment {
  type: "added" | "deleted" | "unchanged";
  text: string;
}

export function computeDocumentDiff({
  originalText,
  modifiedText,
}: {
  originalText: string;
  modifiedText: string;
}): DiffSegment[] {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(originalText, modifiedText);
  dmp.diff_cleanupSemantic(diffs);

  return diffs.map(([op, text]) => {
    if (op === 1) return { type: "added", text };
    if (op === -1) return { type: "deleted", text };
    return { type: "unchanged", text };
  });
}
```

---

### 2.3 `doc_summarize` (Semantic AI Summarization)
Generates an executive summary or key bullet takeaways grounded strictly in the extracted document text using Gemini 2.5 Flash.

```typescript
import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai/providers";

export async function summarizeDocument({
  documentText,
  length = "standard",
  format = "executive_summary",
}: {
  documentText: string;
  length?: "brief" | "standard" | "detailed";
  format?: "bullets" | "executive_summary";
}): Promise<string> {
  const prompt = `You are a precise document analyst. Analyze the following document text and provide a ${length} ${format}. Focus only on facts directly stated in the text.\n\nDocument Text:\n${documentText.slice(0, 100000)}`;

  const { text } = await generateText({
    model: getLanguageModel("gemini-2.5-flash"),
    prompt,
  });

  return text;
}
```

---

## 3. Dynamic Right Pane: Document Studio Canvas (`artifacts/text/client.tsx`)

The Right Pane dynamically mounts `<DocumentStudioCanvas />` when an artifact has `kind: 'text'`:

```
+---------------------------------------------------------------------------------------------------+
| Dynamic Document Studio Canvas                                                                    |
+---------------------------------------------------------------------------------------------------+
| Telemetry: [Words: 3,420] [Reading Time: 14 min] | Mode: [Reader View | Diff Comparison]           |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    Side-by-Side Diff Comparison View:                                                             |
|    ┌────────────────────────────────────────┬────────────────────────────────────────┐            |
|    │ Version 1 (Original)                   │ Version 2 (Revised Summary)            │            |
|    ├────────────────────────────────────────┼────────────────────────────────────────┤            |
|    │ The agreement shall commence on the    │ The agreement shall commence on the    │            |
|    │ first day of January [-2024-].         │ first day of January {+2026+}.         │            |
|    │                                        │                                        │            |
|    │ [-All fees must be wired manually.-]   │ {+All payments occur automatically via+}│            |
|    │                                        │ {+authorized payment gateways.+}       │            |
|    └────────────────────────────────────────┴────────────────────────────────────────┘            |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
| Actions: [Copy Clean Markdown] [Download as TXT] [Export Formatted PDF]                           |
+---------------------------------------------------------------------------------------------------+
```

### Key UI Features:
1. **Reading & Diff Toggle**: Switch effortlessly between clean distraction-free reader mode and visual side-by-side diff.
2. **Highlighted Diff Markers**: Green additions (`+`) and red deletions (`-`) with inline change detection.
3. **Word & Reading Stats**: Live word count, character count, and estimated reading time.
4. **Export Affordances**: Copy to clipboard, export as Markdown, or download as formatted text.
