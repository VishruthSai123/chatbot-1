# Master Architecture: Native-First Execution & Contextual Workbench Wiring

## 1. Core Architectural Principle: Zero-SaaS, Native-First Processing

Traditional AI wrappers outsource file operations to third-party paid APIs (e.g., CloudConvert, Remove.bg, ConvertAPI, external OCR SaaS). This introduces three critical liabilities:
1. **Compounding Recurring Costs**: Every user operation costs money per conversion.
2. **Third-Party Data Leakage**: User files are transmitted across unvetted external vendor networks.
3. **Network Latency & Downtime**: Vulnerable to third-party rate limits, outages, and format changes.

### The Workbench Native Rule
> **All deterministic operations must run natively within our Next.js backend, Node.js runtime, or browser client using vetted, high-performance open-source libraries. External AI APIs (Google Gemini) are strictly reserved for tasks requiring semantic understanding, structured planning, or multimodal synthesis.**

```
+-------------------------------------------------------------------------------------------------------------+
|                                  NATIVE-FIRST CONTEXTUAL EXECUTION TOPOLOGY                                 |
+-------------------------------------------------------------------------------------------------------------+
|                                                                                                             |
|  [User Request]                                                                                             |
|       │                                                                                                     |
|       ▼                                                                                                     |
|  [Chat Command Center]  ◄──►  [Contextual Tool Inspector (Right Pane)]                                      |
|  (Renders minimal card)       (Mounts ONLY the active tool controls)                                        |
|       │                               ▲                                                                     |
|       ▼                               │ (Signed URLs / Lineage sync)                                        |
|  [Gemini 2.5 Planner]                 │                                                                     |
|  (Injected with active image context) │                                                                     |
|       │                               │                                                                     |
|       ▼                               │                                                                     |
|  [Zod-Validated Tool Dispatcher]      │                                                                     |
|  (Defaults source to active artifact) │                                                                     |
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
|   - Register newly generated artifact as the active context for subsequent turns                            |
|                                                                                                             |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 2. Full-Stack End-to-End Wiring Architecture

The application operates as a synchronized conversational command center with modular, tool-specific contextual inspectors:

### 2.1 In-Chat Interactive Minimal Cards
When a tool runs, it outputs an interactive card in the chat stream:
- **Compact & Lightweight**: Shows thumbnail, title, dimension/size deltas, and actionable buttons.
- **Click-to-Inspect**: Clicking the card opens the Right Pane pre-focused on the specific tool that ran.
- **Direct Download**: Users can immediately download the artifact without needing to open the side panel.

### 2.2 Storage Layer: Supabase Storage (`lib/storage/index.ts`)
- **Bucket**: `artifacts` (Private bucket with Row-Level Security).
- **Partitioning**: `{userId}/{chatId}/{timestamp}-{safeFilename}`.
- **Access Pattern**: Short-lived signed URLs (1 hour for downloads, 7 days for in-app Studio preview sessions).
- **Lifecycle**: Original uploads are immutable (`parentArtifactId = null`). All transformations generate new derivative artifacts with foreign key lineage (`parentArtifactId = source.id`).

### 2.3 Conversational State & Image Chaining (`lib/ai/prompts.ts` & `app/(chat)/api/chat/route.ts`)
- The active image artifact is tracked across the conversation.
- When a user asks for sequential edits (*"now make it 300 DPI"*, *"now remove background"*, *"now compress to 50KB"*):
  1. The LLM receives the active image's signed URL, dimensions, and format in its context.
  2. The tool call automatically uses this active image as its `source` without requiring the user to re-upload.
  3. The resulting derivative artifact becomes the new active context for the next turn.

### 2.4 Contextual Right Pane Architecture (`components/chat/artifact.tsx` & `components/chat/image/`)
- Managed globally through the `useArtifact()` React hook.
- When an artifact is opened, the Right Pane checks `artifact.toolMode` and mounts the **focused inspector**:
  - `toolMode === 'compress'` $\rightarrow$ `<CompressionInspector />` (Target KB, quality slider, re-compress, before/after compare).
  - `toolMode === 'resize'` $\rightarrow$ `<ResizerInspector />` (Physical mm/in/cm units, DPI, passport presets).
  - `toolMode === 'crop'` $\rightarrow$ `<CropInspector />` (Aspect ratio locks, interactive boundary).
  - `toolMode === 'remove_bg'` $\rightarrow$ `<BackgroundRemovalInspector />` (Transparency checkerboard, solid color backfill swatches).
- **No Monolithic Bloat**: The user is never confronted with an overwhelming kitchen-sink canvas containing every tool at once.

---

## 3. Technology Stack Reference Table

| Capability Family | Primary Native Package | Contextual Inspectors | No-Cost Principle |
| :--- | :--- | :--- | :--- |
| **Image Processing** | `sharp` (libvips C-bindings), `@imgly/background-removal-node` | Compression, Physical Resizer, Crop, Background Remover | Zero external API calls for resize, crop, rotate, format conversion, DPI injection, or background removal. |
| **PDF Processing** | `pdf-lib` (pure JS/TS), `pdf-parse` | Page Organizer, Splitter, Merger, Compressor | Zero native external binaries (no poppler/ghostscript required); runs cleanly in serverless and node. |
| **Data Processing** | `papaparse`, `xlsx` (SheetJS) | Virtual Table Viewer, Column Filter/Sort, Formatter | In-memory stream parsing and virtualized client rendering; no database or SaaS ETL. |
| **Document Processing** | `mammoth`, `diff-match-patch` | Rich Reader, Side-by-Side Diff, Markdown Formatter | Native DOCX/MD parsing and algorithmic character/line diffing; AI used only for summarization. |
| **Media Processing** | `music-metadata`, Web Audio API | Audio Spectrum, Metadata Inspector, Transcription | Zero paid transcription services; metadata extracted locally in Node. |
