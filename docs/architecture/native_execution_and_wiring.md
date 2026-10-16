# Master Architecture: Native-First Execution & Full-Stack Wiring

## 1. Core Architectural Principle: Zero-SaaS, Native-First Processing

Traditional AI wrappers outsource file operations to third-party paid APIs (e.g., CloudConvert, Remove.bg, ConvertAPI, external OCR SaaS). This introduces three critical liabilities:
1. **Compounding Recurring Costs**: Every user operation costs money per conversion.
2. **Third-Party Data Leakage**: User files are transmitted across unvetted external vendor networks.
3. **Network Latency & Downtime**: Vulnerable to third-party rate limits, outages, and format changes.

### The Workbench Native Rule
> **All deterministic operations must run natively within our Next.js backend, Node.js runtime, or browser client using vetted, high-performance open-source libraries. External AI APIs (Google Gemini) are strictly reserved for tasks requiring semantic understanding, structured planning, or multimodal synthesis.**

```
+-------------------------------------------------------------------------------------------------------------+
|                                    NATIVE-FIRST EXECUTION TOPOLOGY                                          |
+-------------------------------------------------------------------------------------------------------------+
|                                                                                                             |
|  [User Request]                                                                                             |
|       │                                                                                                     |
|       ▼                                                                                                     |
|  [Chat Command Center]  ◄──►  [Dynamic Right Pane Studio]                                                   |
|       │                               ▲                                                                     |
|       ▼                               │ (Signed URLs / Lineage sync)                                        |
|  [Gemini 2.5 Planner]                 │                                                                     |
|  (Intent resolution & tool selection) │                                                                     |
|       │                               │                                                                     |
|       ▼                               │                                                                     |
|  [Zod-Validated Tool Dispatcher]      │                                                                     |
|       │                               │                                                                     |
|       ├───────────────────────────────┴───────────────────────────────┐                                     |
|       ▼                                                               ▼                                     |
|  [Deterministic Native Engines]                             [AI Semantic Engine]                            |
|   - Images: `sharp` + native alpha matting                   - Gemini 2.5 Flash / Pro                        |
|   - PDFs: `pdf-lib` + `pdf-parse` (pure JS)                  (Summarization, Intent, Audio Transcription)   |
|   - Sheets: `papaparse` + `xlsx` (SheetJS)                                                                  |
|   - Docs: `mammoth` + `diff-match-patch`                                                                    |
|       │                                                                                                     |
|       ▼                                                                                                     |
|  [Output Verification & Lineage Recording]                                                                  |
|   - Validate file signatures, dimensions, and byte counts                                                   |
|   - Persist derived artifact metadata in Supabase PostgreSQL (`Artifact` table)                            |
|   - Save bytes into Supabase Storage (`artifacts` private bucket)                                           |
|                                                                                                             |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 2. Full-Stack End-to-End Wiring Architecture

The application operates as a synchronized command-and-studio system:

### 2.1 Storage Layer: Supabase Storage (`lib/storage/index.ts`)
- **Bucket**: `artifacts` (Private bucket with Row-Level Security).
- **Partitioning**: `{userId}/{chatId}/{timestamp}-{safeFilename}`.
- **Access Pattern**: Short-lived signed URLs (1 hour for downloads, 7 days for in-app Studio preview sessions).
- **Lifecycle**: Original uploads are immutable (`parentArtifactId = null`). All transformations generate new derivative artifacts with foreign key lineage (`parentArtifactId = source.id`).

### 2.2 Database Layer: Lineage & State Machine (`lib/db/schema.ts`)
Three core tables track all execution:
1. `Artifact`: Stores storage keys, MIME types, detected dimensions, byte size, and parent lineage.
2. `Task`: Represents the user's overarching work request, target state, and idempotency key.
3. `TaskStep`: Represents individual deterministic tool steps, status (`queued`, `running`, `succeeded`, `failed`), retry attempts, and input/output artifact IDs.

### 2.3 Tool Registry & Execution Context (`lib/tools/`)
Every tool implements a standardized contract:
```typescript
export interface ToolDefinition<TInput, TOutput> {
  id: string;
  family: 'image' | 'pdf' | 'sheet' | 'document' | 'media';
  version: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  execute: (input: TInput, context: ExecutionContext) => Promise<TOutput>;
}

export interface ExecutionContext {
  userId: string;
  chatId: string;
  downloadArtifact: (storageKey: string) => Promise<Buffer>;
  saveDerivedArtifact: (args: {
    fileBuffer: Buffer;
    filename: string;
    contentType: string;
    parentArtifactId: string;
  }) => Promise<ArtifactRecord>;
}
```

### 2.4 Dynamic Right Pane Studio (`components/chat/artifact.tsx` & `artifacts/`)
- Managed globally through the `useArtifact()` React hook.
- When an artifact is selected or produced by a tool:
  1. `artifact.isVisible` is set to `true`.
  2. `artifact.kind` matches the artifact category (`'image' | 'pdf' | 'sheet' | 'text'`).
  3. The studio component dynamically mounts:
     - `kind: 'image'` $\rightarrow$ `<ImageStudioCanvas />`
     - `kind: 'pdf'` $\rightarrow$ `<PdfStudioCanvas />`
     - `kind: 'sheet'` $\rightarrow$ `<DataStudioCanvas />`
     - `kind: 'text'` $\rightarrow$ `<DocumentStudioCanvas />`
- **Bidirectional Sync**:
  - **Chat $\rightarrow$ Right Pane**: Assistant returns an artifact card; clicking or generating automatically opens the Right Pane Studio with the artifact's signed URL.
  - **Right Pane $\rightarrow$ Chat**: Performing edits directly on the canvas (e.g. crop handles, DPI preset, remove background, reorder PDF pages) triggers direct deterministic tool execution or inserts structured instructions into the chat composer.

---

## 3. Technology Stack Reference Table

| Capability Family | Primary Native Package | Auxiliary Native Tools | No-Cost Principle |
| :--- | :--- | :--- | :--- |
| **Image Studio** | `sharp` (libvips C-bindings) | HTML5 Canvas, `@imgly/background-removal-node` | Zero external API calls for resize, crop, rotate, format conversion, DPI injection, or background removal. |
| **PDF Studio** | `pdf-lib` (pure JS/TS) | `pdf-parse`, `pdfjs-dist` (client) | Zero native external binaries (no poppler/ghostscript required); runs anywhere in serverless and node. |
| **Data Studio** | `papaparse`, `xlsx` (SheetJS) | `react-data-grid` | In-memory stream parsing and virtualized client rendering; no database or SaaS ETL. |
| **Document Studio** | `mammoth`, `diff-match-patch` | `@streamdown/code`, `shiki` | Native DOCX/MD parsing and algorithmic character/line diffing; AI used only for summarization. |
| **Media Studio** | `music-metadata`, Web Audio API | Gemini 2.5 Flash Audio API | Zero paid transcription services (no Whisper API bills); metadata extracted locally in Node. |
