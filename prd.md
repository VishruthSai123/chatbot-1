<br/>**PRODUCT REQUIREMENTS DOCUMENT**

Universal AI Workbench

_Conversational toolbox + autonomous work agent_

Version 1.0 | Status: Draft for product and engineering alignment | Date: 15 October 2026

Product promise: Tell the AI what outcome you want, provide files or supported links, and receive a verified, usable result inside the conversation—with clear progress, previews, and downloads.

# Document control

| **Field**              | **Value**                                                                      |
| ---------------------- | ------------------------------------------------------------------------------ |
| Working product name   | Universal AI Workbench (placeholder; naming research required)                 |
| Document owner         | Product founder / product lead                                                 |
| Audience               | Product, design, frontend, backend, AI, infrastructure, QA, security           |
| Primary platform       | Responsive web app for desktop and mobile browsers                             |
| Product identity       | Hybrid universal toolbox and autonomous work agent                             |
| Primary differentiator | Broad tool coverage exposed through a unified conversational interface         |
| Target release         | Closed beta MVP; date to be set after engineering discovery                    |
| Status convention      | Requirements marked P0 are launch-critical; P1 are post-core MVP; P2 are later |

## How to read this PRD

This document defines intended product behavior and a proposed technical foundation. It does not claim that integrations, APIs, format support, or infrastructure have already been implemented or verified. Every format and external source must be marked supported only after implementation and testing.

# 1\. Executive summary

Universal AI Workbench is a web-first application where users ask for work in natural language, upload files or provide supported URLs, and receive processed artifacts within the same conversation. It combines a catalog of deterministic utility tools with an AI planning layer that can compose multiple tools into a single workflow. The chat is the command center; the results area becomes a contextual workspace for previews, edits, progress, verification, and downloads.

The product will not attempt to execute arbitrary model-generated code for every request. Instead, AI selects from a controlled registry of versioned tools. A backend workflow engine validates plans, authorizes actions, runs durable jobs, verifies outputs, and stores artifacts with ownership and lineage.

## 1.1 Product vision

Make everyday digital work possible through one understandable interface, regardless of which file format or utility would traditionally be required.

## 1.2 Product principles

- Outcome-first: users describe what they want, not which utility to open.
- Breadth through composability: tools are independently testable and can be chained.
- Verified completion: a task is successful only when its output passes relevant checks.
- Progressive disclosure: simple jobs stay simple; complex jobs expose plan, progress, and controls.
- Recoverability: refreshes, disconnects, and transient failures must not lose authoritative task state.
- Privacy by default: private files, least-privilege access, bounded retention, and transparent processing.
- Honest capability boundaries: unsupported formats and inaccessible links receive clear explanations.

# 2\. Problem statement and opportunity

Users routinely switch between separate websites and applications for PDF operations, image resizing, file conversion, spreadsheet cleanup, document generation, transcription, and other small tasks. They must learn each tool's interface, configure operations, move files between services, and manually combine results.

The proposed opportunity is to reduce that fragmentation through one conversational entry point and a common execution model. Competitive products already offer overlapping capabilities, so differentiation must be demonstrated through breadth, workflow completion, reliable artifacts, and reduced interaction overhead—not through a claim that no competitor offers AI plus tools.

## 2.1 Jobs to be done

- When I have a file, I want to state the outcome and receive a usable result without researching which tool to use.
- When a task requires several operations, I want the system to sequence them and preserve intermediate outputs.
- When I process many files, I want batch operations and consistent settings.
- When a result is produced, I want to inspect it before downloading or continuing to edit it.
- When a task fails or my browser disconnects, I want a truthful status and a safe way to resume or retry.

# 3\. Goals, non-goals, and success measures

## 3.1 Goals

- Deliver a polished responsive chat interface with file upload, task progress, previews, and downloads.
- Launch a curated set of approximately 25–35 well-tested operations across multiple capability families, subject to feasibility and quality gates.
- Support single-step tasks and bounded multi-step workflows through a versioned tool registry.
- Persist task state and artifacts so users can refresh and return without losing completed work.
- Build a safe, extensible architecture that allows new tools to be added without redesigning the core chat.

## 3.2 Non-goals for MVP

- Supporting every file extension or every URL source.
- Recreating full Microsoft Office, Adobe, or professional video-editing applications.
- Arbitrary shell execution or unrestricted model-generated code.
- A public third-party tool marketplace or open plugin ecosystem.
- Autonomous actions in third-party user accounts without explicit authorization.
- Guaranteed extraction or downloading from private, restricted, DRM-protected, or unsupported media URLs.
- Real-time collaborative editing and enterprise administration features.

## 3.3 Proposed launch metrics

| **Metric**                   | **Definition**                                                                | **Initial target / gate**                                          |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Verified completion rate     | Supported benchmark tasks producing valid outputs / supported tasks attempted | ≥95% on the curated non-adversarial benchmark before public beta   |
| Authorization test pass rate | Ownership and access-control tests that pass                                  | 100%; any cross-user access is a release blocker                   |
| False-success rate           | Invalid outputs marked successful / outputs marked successful                 | Zero known failures in release suite                               |
| Recovery correctness         | Interrupted-task scenarios that restore correct state or terminate safely     | All defined critical recovery scenarios pass                       |
| Time to usable result        | Request submission to verified artifact availability                          | Measure by operation family; establish baselines before optimizing |
| Cost per successful task     | Model + API + compute + storage + retries + delivery costs                    | Instrumented by tool and workflow before monetization decisions    |
| User activation              | New users completing one verified task                                        | Establish baseline during closed beta; set target after pilot      |

Targets are proposed internal release gates, not external benchmarks or current performance claims.

# 4\. Target users and primary use cases

| **User segment**                 | **Need**                                             | **Example task**                                                                   |
| -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Students and educators           | Prepare and transform learning materials             | Summarize a PDF, extract tables, generate notes or a presentation                  |
| Office and operations workers    | Reduce repetitive document work                      | Clean a spreadsheet, convert a report, create a PDF deliverable                    |
| Creators and social-media users  | Process media and reuse content                      | Resize batches of images, transcribe audio, create captions from permitted sources |
| Small businesses and freelancers | Avoid purchasing or learning many separate utilities | Merge client PDFs, prepare tables, create standardized documents                   |
| General consumers                | Complete occasional file tasks quickly               | Compress a file under a target size or convert a supported image                   |

## 4.1 Core user journey

1. User opens a new conversation.
2. User types a request, attaches files, pastes a supported URL, or combines these inputs.
3. System inspects inputs and identifies whether required parameters or permissions are missing.
4. For a simple low-risk task, the system runs the appropriate registered tool. For a multi-step or consequential task, it presents a plan or asks for confirmation when needed.
5. The UI displays persisted progress and completed steps.
6. The backend verifies output artifacts and records their lineage.
7. The UI renders appropriate previews, provides downloads, and offers relevant follow-up actions.
8. User can continue from the generated artifact without losing task context.

# 5\. MVP functional requirements

Priority definitions: P0 = required for closed beta; P1 = include if stable within MVP; P2 = post-MVP.

## 5.1 Conversation and agent

| **ID**  | **Priority** | **Requirement**                 | **Acceptance criteria**                                                                                    |
| ------- | ------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CHAT-01 | P0           | Create and reopen conversations | Authenticated user can create, rename where supported, list, open, and continue owned conversations.       |
| CHAT-02 | P0           | Natural-language task input     | User can describe an outcome without selecting a tool first.                                               |
| CHAT-03 | P0           | File attachments in chat        | User can attach multiple supported files and see filename, type, size, upload state, and removal control.  |
| CHAT-04 | P0           | Clarification                   | Agent asks a focused question when a necessary parameter is missing; it does not invent the missing value. |
| CHAT-05 | P0           | Tool selection                  | Agent can propose only tools present in the active registry and supported for the inputs.                  |
| CHAT-06 | P0           | Workflow plan                   | Multi-step requests are represented as validated steps with dependencies and bounded execution.            |
| CHAT-07 | P0           | Progress updates                | UI shows queued/running/waiting/retrying/succeeded/failed/cancelled states from persisted backend state.   |
| CHAT-08 | P0           | Follow-up context               | User can refer to a prior artifact in the same conversation and request a supported transformation.        |
| CHAT-09 | P0           | Honest completion messages      | Assistant distinguishes completed, partial, blocked, unsupported, and failed outcomes.                     |
| CHAT-10 | P1           | Suggested follow-ups            | After completion, show contextually relevant next actions based on actual artifact type.                   |

## 5.2 Upload, file inspection, and artifact management

| **ID**  | **Priority** | **Requirement**             | **Acceptance criteria**                                                                                 |
| ------- | ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| FILE-01 | P0           | Private upload              | Uploads are stored privately and tied to the authenticated owner.                                       |
| FILE-02 | P0           | Validation                  | Validate size, detected type, file signature where applicable, and configured limits before processing. |
| FILE-03 | P0           | Unsupported format handling | Unsupported files are rejected with a useful reason; they are not sent blindly to a parser.             |
| FILE-04 | P0           | Immutable originals         | Original uploads are not overwritten by transformations.                                                |
| FILE-05 | P0           | Artifact lineage            | Every derived artifact can reference its source artifact and producing task/step.                       |
| FILE-06 | P0           | Authorized download         | Downloads require an ownership check and use short-lived access where signed URLs are used.             |
| FILE-07 | P0           | Retention and deletion      | System applies documented retention rules and supports deletion of owned artifacts and temporary files. |
| FILE-08 | P1           | Batch upload                | User can submit a batch and see per-file success/failure outcomes.                                      |

## 5.3 Initial tool families and active catalog

| **Family**     | **Candidate MVP operations**                                                                                         | **Constraints / acceptance**                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PDF            | Merge, split, rotate, reorder pages, compress, extract text/metadata, extract images                                 | Validate resulting PDF opens; verify page count and output size where relevant.                     |
| Images         | Resize (pixels & physical: cm, mm, in, DPI), crop, rotate, compress, convert formats, thumbnails, **background removal** (transparent PNG / solid backfill) | Verify output dimensions against target physical units (px = mm/25.4 * DPI); verify alpha transparency, format decodability; provide original/result canvas comparison. |
| Spreadsheets   | Read/write CSV and XLSX, filter, sort, remove duplicates, totals, summary statistics, basic charts                   | Preserve data types where possible; report skipped/ambiguous cells and validate workbook structure. |
| Documents      | Extract text, summarize, compare/diff, generate formatted DOCX/PDF                                                   | Clearly disclose OCR/formatting limitations; verify generated file opens.                           |
| Presentations  | Generate basic PPTX from structured content; extract slide text; export to PDF when engine supports it               | Test slide count, text overflow, rendering and conversion fidelity.                                 |
| Audio/video    | Metadata extraction, uploaded-audio transcription, transcript summaries/subtitles; limited clip/extraction workflows | Only enable operations with verified engines/codecs and acceptable resource limits.                 |
| URL connectors | Start with explicitly supported public sources and permitted metadata/transcript access                              | No universal URL guarantee; handle authentication, restrictions, redirects, and source policy.      |

### 5.3.1 Active Chat Tool Catalog (Launch Scope: 28 Core Operations)

The system exposes a controlled, versioned registry of deterministic and AI tools. Each tool is invocable either through natural language requests in the chat timeline or directly through interactive controls in the Dynamic Right Pane Studio.

| **Tool ID** | **Family** | **Execution Engine** | **Primary Inputs & Parameters** | **Outputs & Acceptance Invariants** | **UI Affordances** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `image_resize` | Image | Deterministic (`sharp`) | `artifactId`, `width` (px), `height` (px), `fit` (cover/contain/fill), `maintainAspectRatio` (bool) | Valid raster image with exact requested dimensions; decodable. | Chat prompt & Right Pane slider |
| `image_resize_physical` | Image | Deterministic (`sharp`) | `artifactId`, `width`, `height`, `unit` (`cm`, `mm`, `in`), `dpi` (72, 150, 300, 600), `preset` (optional) | Output pixel dimensions equal $\frac{\text{dim}_{\text{mm}}}{25.4} \times \text{DPI}$; JFIF/EXIF density tags embedded; passes passport/visa validation checks. | Chat prompt & Right Pane Physical Unit Selector |
| `image_remove_bg` | Image | Pipeline (Matting / Segmentation) | `artifactId`, `mode` (`transparent` \| `solid_color`), `backgroundColor` (hex string, default `#ffffff`) | Output PNG with clean alpha transparency or solid color backfill; verifies edge delineation. | Chat prompt ("remove background") & Right Pane 1-click Canvas button |
| `image_crop` | Image | Deterministic (`sharp`) | `artifactId`, `x`, `y`, `width`, `height` (pixels or % bounding box), `aspectRatio` | Bounded region extracted without distortion; verified dimensions. | Chat prompt & Right Pane Drag Handles |
| `image_rotate` | Image | Deterministic (`sharp`) | `artifactId`, `degrees` (90, 180, 270), `flip` (`horizontal` \| `vertical`) | Correctly rotated pixels and updated EXIF orientation. | Chat prompt & Right Pane Rotate Buttons |
| `image_compress` | Image | Deterministic (`sharp`) | `artifactId`, `targetSizeKb` (optional), `quality` (1–100), `format` | Output file size $\le$ target (within 5% tolerance) or requested quality level. | Chat prompt & Right Pane Quality Slider |
| `image_convert` | Image | Deterministic (`sharp`) | `artifactId`, `targetFormat` (`png`, `jpeg`, `webp`, `avif`, `tiff`, `gif`) | Valid file signature matching target format; decodable. | Chat prompt & Right Pane Format Dropdown |
| `image_get_metadata` | Image | Deterministic (`sharp`) | `artifactId` | Returns JSON: width, height, color space, channels, DPI density, format, byte size. | Chat card & Right Pane Info Badge |
| `pdf_merge` | PDF | Deterministic (`pdf-lib`) | `artifactIds` (array $\ge 2$), `outputFilename` | Single valid PDF containing all input pages in sequential order. | Chat prompt & Right Pane File Queue |
| `pdf_split` | PDF | Deterministic (`pdf-lib`) | `artifactId`, `pageRanges` (e.g., `"1-3, 5, 7-10"`) | One or more valid PDFs containing exact selected page subsets. | Chat prompt & Right Pane Page Selector |
| `pdf_rotate_pages` | PDF | Deterministic (`pdf-lib`) | `artifactId`, `pages` (`"all"` or `[1, 3]`), `rotation` (90, 180, 270) | Rotated pages render at target orientation; page count preserved. | Chat prompt & Right Pane Page Rotate Tool |
| `pdf_reorder_pages`| PDF | Deterministic (`pdf-lib`) | `artifactId`, `pageOrder` (array of 1-based page indices: `[3, 1, 2]`) | Valid PDF with pages reordered exactly as specified; no dropped pages. | Chat prompt & Right Pane Drag-and-Drop Grid |
| `pdf_compress` | PDF | Deterministic (`pdf-lib` / Ghostscript/qpdf) | `artifactId`, `compressionLevel` (`low`, `medium`, `high`) | Smaller byte size; text and raster assets remain legible. | Chat prompt & Right Pane Size Target |
| `pdf_extract_text` | PDF | Deterministic (`pdf-parse`) | `artifactId`, `pages` (optional range) | Extracted plain text structured by page numbers; unicode decoded. | Chat response & Document Studio reader |
| `pdf_extract_images`| PDF | Deterministic (`pdf-lib`) | `artifactId` | ZIP or individual image artifacts of all embedded rasters. | Chat response & Image Studio Gallery |
| `pdf_get_metadata` | PDF | Deterministic (`pdf-parse`) | `artifactId` | Returns JSON: page count, PDF version, title, author, creation date. | Chat card & PDF Studio Info Bar |
| `sheet_filter_sort`| Data | Deterministic (`xlsx` / `papaparse`) | `artifactId`, `filterColumn`, `operator` (`==`, `!=`, `>`, `<`, `contains`), `value`, `sortColumn`, `sortOrder` (`asc` \| `desc`) | Filtered/sorted table artifact (CSV/XLSX); headers and data types preserved. | Chat prompt & Data Studio Column Filter |
| `sheet_remove_duplicates` | Data | Deterministic (`xlsx` / `papaparse`) | `artifactId`, `keyColumns` (optional subset or all) | Deduplicated table; report of row count before and after. | Chat prompt & Data Studio Dedupe Button |
| `sheet_summary_stats` | Data | Deterministic (`xlsx` / `papaparse`) | `artifactId` | Descriptive stats per column: count, mean, median, min, max, nulls, unique count. | Chat response & Data Studio Metric Cards |
| `sheet_convert_format`| Data | Deterministic (`xlsx` / `papaparse`) | `artifactId`, `targetFormat` (`csv`, `tsv`, `xlsx`, `json`) | Converted file with identical rows, columns, and data values. | Chat prompt & Data Studio Export Menu |
| `sheet_clean_data` | Data | Deterministic (`xlsx` / `papaparse`) | `artifactId`, `trimWhitespace` (bool), `fillMissing` (`drop` \| `null` \| `value`), `standardizeDates` (bool) | Cleaned dataset; audit log of modified or dropped cells. | Chat prompt & Data Studio Clean Button |
| `sheet_generate_chart`| Data | Deterministic / AI | `artifactId`, `chartType` (`bar`, `line`, `pie`, `scatter`), `xColumn`, `yColumn`, `title` | SVG/PNG chart artifact and interactive preview JSON for Right Pane. | Chat response & Right Pane Chart Canvas |
| `doc_summarize` | Document | AI (`gemini-2.5-flash` / `pro`) | `artifactId`, `length` (`brief`, `standard`, `detailed`), `format` (`bullets`, `executive_summary`) | High-fidelity summary grounded in source text; includes key takeaways and section anchors. | Chat response & Document Studio reader |
| `doc_extract_text` | Document | Deterministic (`mammoth` / `pdf-parse`) | `artifactId` | Plain text and Markdown extracted from DOCX/PDF/HTML without binary artifacts. | Chat response & Document Studio viewer |
| `doc_convert` | Document | Deterministic / Engine | `artifactId`, `targetFormat` (`md`, `txt`, `html`, `pdf`, `docx`) | Valid output document with intact hierarchy, paragraphs, and headings. | Chat response & Download Card |
| `doc_compare_diff` | Document | Deterministic (`diff-match-patch`) | `originalArtifactId`, `modifiedArtifactId` | Inline diff structure identifying additions, deletions, and unchanged blocks. | Chat summary & Document Studio Split Diff |
| `media_transcribe` | Audio/Video | AI (`gemini-2.5-flash` multimodal) | `artifactId`, `language` (optional), `timestamps` (bool) | Structured transcript artifact with timestamps, speaker cues, and text segments. | Chat response & Media Studio Transcript Pane |
| `media_get_metadata`| Audio/Video | Deterministic (`ffprobe` / Web Audio) | `artifactId` | Returns JSON: duration (seconds), audio bitrate, sample rate, channels, video resolution. | Chat card & Media Info Card |

---

### 5.3.2 Deep-Dive: Image Studio, Physical Resizing, and Background Removal

#### A. Physical Dimension Resizing Engine (`image_resize_physical`)
Standard digital image utilities only think in screen pixels (`px`), but users routinely need photos resized for real-world print specifications—such as passport photos, visa submissions, job application forms, and printed identity cards.

1. **Unit Conversion Mathematics**:
   $$\text{Pixels} = \frac{\text{Physical Dimension in Millimeters}}{25.4} \times \text{DPI}$$
   $$\text{Pixels} = \text{Physical Dimension in Inches} \times \text{DPI}$$
   - Conversion Constants: $1\text{ in} = 25.4\text{ mm} = 2.54\text{ cm}$.
   - Density Tags: Output images must write the requested DPI directly into JFIF (`Xdensity`/`Ydensity`) or EXIF (`XResolution`/`YResolution`) headers so print drivers and automated visa portal validation algorithms recognize the correct physical sizing.

2. **Standard Document & Visa Presets**:
   | **Preset Name** | **Physical Dimensions** | **Standard DPI** | **Resulting Dimensions (px)** | **Aspect Ratio** | **Requirements** |
   | :--- | :--- | :--- | :--- | :--- | :--- |
   | **Indian Passport / OCI** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Plain light/white background, 70-80% face coverage |
   | **US Visa / US Passport** | $2\text{ in} \times 2\text{ in}$ ($50.8 \times 50.8\text{ mm}$) | 300 DPI | $600 \times 600\text{ px}$ | $1:1$ | Plain white background, head height between $1\text{ in}$ and $1\frac{3}{8}\text{ in}$ |
   | **Schengen Visa** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Light grey/white background, neutral expression |
   | **UK / Australian Visa** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Cream/light grey background, clear border |
   | **Stamp Size** | $20\text{ mm} \times 25\text{ mm}$ | 300 DPI | $236 \times 295\text{ px}$ | $4:5$ | Compact ID/certificate photos |
   | **Indian PAN Card** | $25\text{ mm} \times 35\text{ mm}$ | 300 DPI | $295 \times 413\text{ px}$ | $5:7$ | Strict file size requirement $\le 50\text{ KB}$ |
   | **Standard Photo Print (4x6)** | $4\text{ in} \times 6\text{ in}$ ($101.6 \times 152.4\text{ mm}$) | 300 DPI | $1200 \times 1800\text{ px}$ | $2:3$ | High-resolution lab print |

3. **DPI Selection Modes**:
   - `72 DPI`: Web and screen display.
   - `150 DPI`: Standard office forms and digital government portal uploads with strict file size limits.
   - `300 DPI` (Default): Professional photo print and formal visa/passport physical submissions.
   - `600 DPI`: Archival high-definition print.

#### B. Background Removal Engine (`image_remove_bg`)
1. **Invocation Paths**:
   - **Conversational (Chat Timeline)**: User types *"remove the background from this photo"*, *"make the background transparent"*, or *"change background to pure white"*. The Gemini AI agent recognizes the intent, maps it to `image_remove_bg`, extracts the optional target background color, and executes the pipeline.
   - **Interactive (Right Pane Studio Canvas)**: When viewing an image artifact in the right pane, an immediate **"Remove Background"** button is pinned to the Studio toolbar. Clicking it triggers instant execution, displaying real-time processing and a side-by-side comparison slider.
2. **Output Modes**:
   - `transparent`: Produces a 32-bit RGBA PNG with a full alpha channel. The Right Pane canvas displays this against an industry-standard neutral checkerboard pattern.
   - `solid_color`: Replaces the segmented background with a user-specified hex or RGB color (e.g., `#FFFFFF` for official passport requirements, `#F0F4F8` for studio portraiture, or any custom color chosen via the color picker in the Studio pane).

---

## 5.4 Workflow orchestration

- Every task receives a stable task ID and every step receives a stable step ID.
- Plans are validated against registered tool schemas before execution.
- Steps declare dependencies; independent steps may run concurrently within limits.
- Every step persists input references, tool version, attempt count, status, output references, and structured errors.
- Retries are bounded and only allowed for classified retryable errors.
- Idempotency prevents duplicate artifacts, external charges, or conflicting execution on retries.
- Cancellation is persisted and propagated to workers; UI cancellation alone is not considered authoritative.
- A task may finish partially, but completed and failed steps must be clearly distinguished.
- Output verification is a separate step from tool invocation where practical.
- The system enforces limits on step count, wall time, CPU, memory, output size, and external spend.

## 5.5 Artifact previews, results, and Dynamic Right Pane Studio

| **ID** | **Priority** | **Requirement** | **Acceptance criteria** |
| :--- | :--- | :--- | :--- |
| ART-01 | P0 | Result card | Each output shows a safe filename, format, size when known, status, preview affordance, and download action. |
| ART-02 | P0 | Type-specific preview | PDF, image, table and generic binary artifacts use appropriate renderers. |
| ART-03 | P0 | Output verification | A task is not marked successful until required validation passes. |
| ART-04 | P0 | Multiple outputs | A workflow can return several artifacts with clear relationships. |
| ART-05 | P0 | Partial results | If some steps fail, successful artifacts remain accessible and the UI explains what is missing. |
| ART-06 | P1 | Inline edits | Where supported, users can adjust parameters or content and create a new artifact version. |
| ART-07 | P0 | Dynamic Right Pane Studio | Right pane dynamically mounts dedicated interactive studio canvases by artifact kind: **Image Studio Canvas**, **PDF Studio Canvas**, **Data Studio Canvas**, and **Document Studio Canvas**. |
| ART-08 | P0 | Split Layout Command Center | Desktop workspace splits seamlessly into 40% Chat Command Center and 60% Interactive Studio Pane, synchronized with conversational tool operations. Mobile renders full-screen sheet with effortless toggle. |
| ART-09 | P0 | Bidirectional Synchronization | Conversational commands update the Right Pane canvas; actions on the canvas (crop, resize, bg removal, page selection) dispatch structured tool executions back into the chat and lineage graph. |

### 5.5.1 Multi-Family Dynamic Right Pane Studio Architecture

The right pane is not a static preview container or an image-only viewer. It is a **context-aware, multi-family Interactive Studio** that dynamically mounts specialized studio components based on the active artifact's `kind`.

```
+---------------------------------------------------------------------------------------------------+
| Universal AI Workbench Workspace                                                                  |
+-----------------------------------+---------------------------------------------------------------+
| Left Pane (40%): Chat Command     | Right Pane (60%): Dynamic Studio Canvas                       |
| - Conversational prompt           | [Header: Title, Version, Kind, Download, Close]               |
| - Multi-file upload dropzone      |                                                               |
| - Stepped execution plan status   | Dynamic Studio View (Mounted based on artifact.kind):         |
| - Inline artifact result cards    |  - kind == 'image':  Image Studio (Canvas, Crop, BgRemover)   |
| - Follow-up suggestions           |  - kind == 'pdf':    PDF Studio (Page Grid, Reorder, Split)   |
| - Token & latency metrics         |  - kind == 'sheet':  Data Studio (Sort/Filter Grid, Stats)    |
|                                   |  - kind == 'text':   Document Studio (Reader, Diff Viewer)    |
+-----------------------------------+---------------------------------------------------------------+
```

#### 1. Image Studio Canvas (`kind: 'image'`)
- **Interactive Canvas Surface**: Hardware-accelerated HTML5 canvas supporting smooth Pan (drag to move) and Zoom (mouse scroll wheel, pinch-to-zoom on touchpads, or zoom slider from $10\%$ to $500\%$).
- **Visual Crop Box**: Draggable and resizable bounding box overlay with 8 corner/edge anchor handles. Supports aspect ratio locking (Freeform, 1:1 Square, 4:5 Portrait, 16:9 Landscape, 35x45mm Passport, 2x2in US Visa).
- **Physical Unit Control Bar**:
  - Live unit toggle: `px` $\leftrightarrow$ `cm` $\leftrightarrow$ `mm` $\leftrightarrow$ `in`.
  - DPI selection dropdown: 72 DPI, 150 DPI, 300 DPI, 600 DPI.
  - One-click Document Preset Buttons (Indian Passport, US Visa, Schengen, Stamp size).
  - Live pixel resolution indicator: updates dynamically as physical units or DPI change.
- **Background Removal Action Panel**:
  - One-click **"Remove Background"** button with immediate processing state.
  - Transparent checkerboard canvas mode vs Solid Color backfill picker (Hex / RGB / White / Light Blue).
  - Before/After split slider to inspect edge matting quality.
- **Canvas Action Toolbar**: Rotate 90° Clockwise, Flip Horizontal, Flip Vertical, Reset to Original, Save as New Version, and Download (PNG, JPEG, WEBP).

#### 2. PDF Studio Canvas (`kind: 'pdf'`)
- **Visual Page Thumbnail Grid**: Renders rendered thumbnails of every page in the document.
- **Drag-and-Drop Page Reordering**: Users can reorder pages visually; dropping a page updates the sequence and enables a "Save Reordered PDF" action.
- **Per-Page Controls**: Hover affordances on each thumbnail to rotate that individual page by 90° or mark it for deletion.
- **Visual Page Range Splitter**: Users click individual thumbnails or click-and-drag across pages to select a split range (e.g. pages 2–5). A prominent "Extract Selected Pages" button triggers `pdf_split`.
- **Integrated High-Resolution Page Reader**: Double-clicking any thumbnail opens a full-bleed, high-resolution reader with page navigation and text search.

#### 3. Data & Spreadsheet Studio Canvas (`kind: 'sheet'`)
- **Virtualized High-Performance Grid**: Renders thousands of rows from CSV and XLSX files smoothly without browser DOM slowdowns.
- **Interactive Column Header Actions**:
  - Click-to-sort: Toggle ascending / descending order by clicking any column header.
  - Column filter: Instant text search / threshold filter per column.
  - Type inference badges: Displays detected type (`number`, `string`, `date`, `boolean`) next to header.
- **Top Metric Cards Summary Bar**: Instant calculation of Total Rows, Total Columns, File Size, Null/Empty Cells Count, and Numeric Column Averages.
- **Export Toolbar**: One-click download as clean CSV, formatted XLSX, or structured JSON.

#### 4. Document & Text Studio Canvas (`kind: 'text'` / `'document'`)
- **Rich Document Reader**: Renders Markdown, TXT, and extracted DOCX content with clean typography, code block syntax highlighting, and table formatting.
- **Side-by-Side Diff Comparison View**: When reviewing derived artifacts (e.g. summarized text, cleaned content, or rewritten documents), users can toggle the **Diff View** to see side-by-side original vs derived with highlighted additions (green) and deletions (red).
- **Document Telemetry**: Word count, character count, estimated reading time, and heading outline navigation.
- **Export & Copy**: One-click "Copy Clean Text", "Download Markdown", or "Print to PDF".

---

### 5.5.2 Bidirectional Synchronization Engine (Chat ↔ Right Pane)

The application enforces continuous two-way synchronization between the conversational AI timeline and the interactive Right Pane Studio:

1. **Chat to Studio Flow**:
   - When the user asks a question or instructs the AI to process a file in chat, the AI chooses the appropriate tool, executes it on the backend, and emits an artifact result card.
   - The UI automatically updates the `useArtifact` global state, setting `artifact.isVisible = true` and `artifact.kind = [image | pdf | sheet | text]`.
   - The Right Pane mounts the specialized studio view and immediately loads the fresh signed Supabase Storage URL.

2. **Studio to Chat Flow**:
   - When the user performs an interactive physical edit directly in the Studio pane (e.g. adjusts the crop box to $35\times45\text{ mm}$, clicks "Remove Background", or reorders PDF pages), the Studio canvas exposes an **"Apply Changes"** or **"Ask AI to Transform"** button.
   - Clicking this executes the corresponding backend tool, registers a new derived artifact with lineage pointing to the source artifact, and appends a confirmation event card into the conversational timeline.

## 5.6 Accounts, quotas, and settings

- Authentication is required before private uploads and task execution.
- All data access is scoped to the authenticated user and conversation ownership.
- Apply configurable limits for file size, number of files, concurrent tasks, task duration, and daily usage.
- Show clear messages when quotas or file limits are reached.
- Keep provider secrets and storage credentials on the server; never expose them in browser code.
- Provide account-level data deletion and document what data is retained for operational or legal reasons.

# 6\. UX and design requirements

## 6.1 Layout

- **Desktop Workspace (40/60 Split Command Center)**: 
  - Left Pane (40% width): Collapsible conversation history sidebar, conversational chat timeline, multi-file attachment dropzone, stepped task execution indicators, and inline artifact result cards.
  - Right Pane (60% width): Dynamic Studio Canvas (`<Artifact />`) that seamlessly mounts interactive workspaces according to `artifact.kind` (Image Studio, PDF Studio, Data Studio, Document Studio).
- **Mobile Responsive Experience**:
  - Full-width mobile chat timeline with a persistent bottom drawer / modal sheet toggle to flip into full-screen Dynamic Studio mode without losing conversational context.
- **Composer Controls**: Supports natural language text prompts, multi-file attachments (up to 50MB per file), paste events, desktop drag-and-drop, and clear real-time upload progress indicators.
- **Long-Running & Stepped Tasks**: Step-by-step progress cards showing real-time states (queued, running, verified, complete) with safe background persistence.
- **Direct Previews and Downloads**: High-speed signed URLs from Supabase Storage for direct browser viewing and downloads.
- **Accessibility & Polish**: Accessible focus states, keyboard shortcuts, screen reader labels, dark mode aesthetic, and reduced-motion animations.

## 6.2 Interaction principles

- Do not ask users to choose a tool when intent is sufficiently clear.
- Ask only for missing information that changes execution or safety.
- Show a concise plan for workflows with meaningful cost, duration, or irreversible consequences.
- Use confirmation for destructive actions, external publishing, or charges beyond an explicitly accepted limit.
- Keep raw technical errors in logs; show users actionable, non-sensitive messages.
- Do not imply a file is ready until it is stored and verified.

# 7\. Technical architecture

Finalized baseline: Next.js 16 + React 19 + TypeScript for the responsive web app; Supabase PostgreSQL (via IPv4 Session Pooler) with Drizzle ORM for identity, task state machine, and lineage metadata; Supabase Storage (private `artifacts` bucket) for immutable originals and derived outputs with short-lived signed URLs; Google Gemini 2.5 Flash and Gemini 2.5 Pro as the primary AI model adapter via `@ai-sdk/google`; a controlled Zod-validated tool registry; and an interactive Dynamic Right Pane Studio Canvas.

| **Layer**          | **Responsibility**                                                                   | **Design rule**                                                          |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Web client         | Chat, upload UX, progress, previews, downloads                                       | Never trusted as source of task truth or authorization                   |
| Application API    | Auth checks, conversation APIs, task creation, signed access, orchestration commands | Validate every request and ownership boundary                            |
| AI adapter         | Intent resolution, planning, structured responses                                    | Provider-independent interface; model output is untrusted input          |
| Tool registry      | Versioned tool metadata, schemas, permissions, execution adapters                    | Only registered tools are invocable                                      |
| Workflow engine    | Dependencies, states, retries, cancellation, idempotency                             | Persist state transitions and recover after process restart              |
| Queue/worker       | Asynchronous execution and resource management                                       | Separate from request lifecycle; bounded concurrency                     |
| Processing sandbox | Parsers, converters, OCR and media executables                                       | Least privilege, resource caps, temporary filesystem, restricted network |
| Database           | Users, conversations, tasks, steps, artifacts, audit records                         | Ownership constraints, indexes, RLS and retention                        |
| Object storage     | Originals, intermediate outputs, final artifacts                                     | Private by default; scoped access and cleanup                            |
| Observability      | Logs, metrics, traces, alerts                                                        | Redact file contents, tokens, secrets and sensitive prompts              |

## 7.1 Tool contract

Each tool definition should include: stable ID and version; description; input and output schemas; accepted and produced artifact types; execution mode; resource limits; permissions; cost/usage metadata; timeout; idempotency behavior; validation checks; and a handler that accepts a server-created execution context. Use runtime schema validation, such as Zod, for input and output contracts. Do not allow the model to supply arbitrary executable code or raw internal storage paths.

## 7.2 Proposed data model

| **Entity**    | **Purpose / important fields**                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| users         | Identity reference, account status, quota configuration                                                               |
| conversations | id, user_id, title, created_at, updated_at                                                                            |
| messages      | id, conversation_id, role, content/structured blocks, timestamps                                                      |
| artifacts     | id, user_id, conversation_id, parent_artifact_id, storage_key, filename, detected_mime, kind, size, status, retention |
| tasks         | id, user_id, conversation_id, request, plan, status, error_code, idempotency_key, timestamps                          |
| task_steps    | id, task_id, step_key, tool_id/version, dependencies, input references, status, attempts, output references           |
| tool_registry | tool_id, version, schemas, supported types, enabled status, policy metadata                                           |
| usage_events  | user_id, task_id, tool_id, model usage, external cost, compute duration, storage usage                                |
| audit_events  | actor, action, resource, outcome, timestamp, safe metadata                                                            |

This is a logical model. Exact columns, foreign keys, partitioning, indexes, JSONB usage, and RLS policies must be finalized during implementation. Enforce unique(task_id, step_key) or an equivalent invariant for stable step identity.

## 7.3 Task state machine

Define explicit states such as queued, planning, waiting_for_user, running, retrying, partially_succeeded, succeeded, failed, cancel_requested, and cancelled. Define legal transitions and terminal states in code and database constraints where feasible. The browser is a view of persisted state; reconnect must refetch authoritative state before attempting any action.

## 7.4 API surface (illustrative)

| **Endpoint / operation**         | **Purpose**                                             |
| -------------------------------- | ------------------------------------------------------- |
| POST /api/conversations          | Create a conversation                                   |
| GET /api/conversations/:id       | Read an owned conversation and message history          |
| POST /api/uploads/initiate       | Create a bounded, authorized upload session             |
| POST /api/uploads/complete       | Validate upload completion and create artifact metadata |
| POST /api/tasks                  | Create a task from a user request and artifact IDs      |
| GET /api/tasks/:id               | Retrieve authoritative task and step state              |
| POST /api/tasks/:id/cancel       | Request persisted cancellation                          |
| POST /api/tasks/:id/retry        | Retry an eligible failed step/task safely               |
| GET /api/artifacts/:id           | Retrieve authorized artifact metadata                   |
| POST /api/artifacts/:id/download | Issue a short-lived authorized download                 |
| GET /api/tools/capabilities      | Return user-visible supported capability metadata       |

Endpoints are proposals; final route names and payload schemas are implementation decisions.

# 8\. AI behavior and orchestration policy

- The model proposes intent, plan, tool IDs, and parameters; the server validates all of them.
- The model cannot bypass quotas, access checks, safety rules, tool permissions, or confirmation gates.
- The model must distinguish unsupported, inaccessible, ambiguous, and failed inputs from successful processing.
- Uploaded documents, extracted text, webpages, and transcripts are untrusted data and may contain prompt-injection attempts.
- Do not treat instructions inside a document as authorization to invoke tools or expose data.
- Keep system policy and secrets outside user-controlled context.
- Limit model calls, plan size, recursion, tool invocations, output tokens, and total task budget.
- Use deterministic code for deterministic transformations; use AI where semantic understanding or generation is valuable.
- Store enough execution metadata to reproduce or debug results without unnecessarily retaining sensitive content.
- Use an evaluation suite to compare models on structured-plan validity, correct tool selection, ambiguity handling, and cost.

# 9\. Security, privacy, and compliance

## 9.1 Threat model and controls

| **Threat**                           | **Required controls**                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious documents / parser exploit | Sandbox processing; patch dependencies; no privileged execution; CPU, memory, file-count and wall-time limits.                        |
| Cross-user artifact access           | Server-side ownership checks on every route; private buckets; RLS tests; no guessable public URLs.                                    |
| SSRF through user URLs               | Allowlisted domains where possible; block loopback, link-local and private ranges; revalidate redirects and DNS; egress restrictions. |
| Malware / dangerous content          | File screening where feasible; safe download behavior; never execute uploaded files; quarantine suspicious uploads.                   |
| Prompt injection                     | Treat content as data; enforce tool allowlists and permissions outside the model; isolate browsing/connectors.                        |
| Resource exhaustion                  | Per-user quotas, upload limits, decompression limits, concurrency controls, task timeouts and cost caps.                              |
| Credential leakage                   | Server-side secrets, secret manager, log redaction, rotation, least privilege.                                                        |
| Data retention exposure              | Defined retention, deletion workflow, temporary-file cleanup, access logs, documented backups and provider processing.                |
| External API misuse                  | Provider allowlists, request validation, terms review, user authorization and bounded spend.                                          |

## 9.2 Privacy requirements

- Explain which files are stored, for how long, and which external providers may process them.
- Do not use uploaded content for model training unless a separate, explicit policy and consent flow authorizes it.
- Minimize data sent to external APIs; transmit only the content needed for the selected operation.
- Provide a deletion path for source files, outputs, and associated metadata subject to clearly disclosed operational/legal retention.
- Avoid logging raw file content, credentials, full signed URLs, or sensitive personal information by default.
- Perform a privacy and legal review before public launch, including relevant Indian law and other jurisdictions served.

## 9.3 URL/media policy

A pasted URL does not imply permission or technical ability to retrieve its media. Support only documented, tested, permitted source workflows. Handle private accounts, age gates, authentication, geographic restrictions, DRM, expired links, platform terms, copyright, and source changes explicitly. Prefer official APIs, user-authorized uploads, and permitted transcript/metadata access. Never promise universal video downloading.

# 10\. Reliability, observability, and QA

## 10.1 Reliability requirements

- Use durable job storage; do not rely on a single HTTP request remaining open.
- Persist every state transition before exposing it as authoritative.
- Use bounded retries with exponential backoff and jitter for transient failures.
- Classify errors into validation, unsupported input, permission, provider, resource limit, timeout, cancellation, and internal failure.
- Implement idempotency for task creation, step execution, artifact creation, and external provider requests where supported.
- Reconcile worker crashes and orphaned running tasks with a recovery process.
- Propagate cancellation to the worker and terminate subprocesses safely.
- Use temporary directories per job and remove them in finally/cleanup paths.
- Alert on repeated failures, queue growth, unusual spend, storage growth, and authorization anomalies.

## 10.2 Test strategy

| **Test layer** | **Coverage**                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Unit           | Tool schemas, validators, file metadata, state transitions, retry classification, size/dimension checks         |
| Integration    | Storage, database, queue, worker, provider adapter, signed downloads, cleanup                                   |
| Golden files   | Known input files with expected output properties and regression checks                                         |
| End-to-end     | Upload → request → plan → execution → preview → download → follow-up                                            |
| Recovery       | Refresh, offline/online transitions, worker restart, duplicate submission, cancellation, timeout                |
| Security       | Cross-user access, SSRF, malicious files, oversized/decompression-bomb files, prompt injection, secret exposure |
| Compatibility  | Desktop/mobile browsers, representative formats, unusual filenames, Unicode and large files                     |
| Quality review | Visual rendering fidelity, OCR accuracy, extracted table correctness and AI summary grounding                   |

## 10.3 Benchmark suite

Maintain approximately 100 representative tasks across supported formats, single-step tasks, multi-step workflows, malformed inputs, unsupported cases, ambiguous instructions, and recovery scenarios. Store expected invariants rather than relying only on subjective model answers. Track tool selection accuracy, valid-plan rate, verified completion rate, false-success rate, cost and latency.

# 11\. External dependencies and licensing

Potential processing candidates include qpdf/pypdf/PDF.js for PDF tasks; Sharp or ImageMagick for images; LibreOffice headless for selected office conversions; ExcelJS or other vetted spreadsheet libraries; Tesseract for OCR; FFmpeg for media processing; and a commercial conversion API such as CloudConvert when needed. These are candidates, not guaranteed coverage.

- Verify the current license and version of every dependency and native binary before shipping.
- Review copyleft, AGPL/LGPL obligations, commercial editions, redistribution rights, codec patents/licensing, and hosted-service conditions with qualified counsel when needed.
- Create a capability matrix showing input/output formats, maximum size, engine, fidelity limitations, expected cost, and test status.
- Keep paid providers behind adapters and use feature flags so provider outages or pricing changes do not require a rewrite.
- Never advertise support for a format solely because a library claims broad format coverage; test actual examples.

# 12\. Monetization and cost controls

Pricing is intentionally undecided for the MVP. First collect usage and cost data. Use quotas and abuse controls before introducing a complicated credit model. Simple deterministic operations should avoid unnecessary model calls.

## 12.1 Cost model

Cost per task = model inference + external API charges + worker compute + storage + bandwidth/delivery + retries and failures. Measure by tool and workflow, including unsuccessful jobs. Apply per-user concurrency, file-size, duration, storage and daily usage limits.

## 12.2 Monetization experiments after beta

- Free tier with modest daily limits and supported file-size caps.
- Paid usage tier for larger files, batch processing, longer media tasks, or higher concurrency.
- Prepaid credits only after operation costs are measured and pricing is understandable.
- Do not charge for a task as successful if the product did not produce the promised deliverable; define fair retry/refund handling.

# 13\. Roadmap and release gates

| **Phase**  | **Focus**                | **Deliverables**                                                                          | **Exit gate**                                                               |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Weeks 1–2  | Foundation               | Auth, private upload, artifact metadata, database, queue/worker, task state machine       | User can submit a test task, refresh, and retrieve authoritative state.     |
| Weeks 3–4  | Deterministic tools      | Initial PDF, image, CSV/XLSX tools, previews, download cards                              | Each shipped tool passes golden-file and validation tests.                  |
| Weeks 5–6  | Agent layer              | Provider adapter, intent resolution, structured plans, tool registry, workflow execution  | Multi-step request invokes registered tools and creates verified artifacts. |
| Weeks 7–8  | Reliability and formats  | DOCX/PPTX capabilities where validated, recovery, cancellation, quotas, security controls | Critical failure and access-control tests pass.                             |
| Weeks 9–10 | Closed beta              | Benchmark, monitoring, retention, mobile QA, limited media pilot                          | Release gates met; known limitations documented.                            |
| Post-MVP   | Breadth and integrations | More tools, URL connectors, saved workflows, versioned outputs, usage tiers               | Prioritize from measured user demand, cost, quality, and risk.              |

Timeline assumes focused development and successful dependency validation. It is not a delivery guarantee. Native conversion, media processing, security review, and operational hardening may extend the schedule.

# 14\. Release acceptance checklist

- ☐ A user can authenticate, create a conversation, upload supported files, and see upload status.
- ☐ Every enabled tool has a schema, limits, owner-safe execution path, output validation, and automated tests.
- ☐ Task state persists across browser refreshes, reconnects, worker restarts, and retry scenarios.
- ☐ No task is reported as successful until its required output validation passes.
- ☐ Users cannot read, overwrite, or download another user's artifacts by changing an ID or URL.
- ☐ Private artifacts are not publicly accessible without authorization.
- ☐ Upload, parser, URL and processing limits are enforced server-side.
- ☐ Tool calls and model usage are bounded by task and user budgets.
- ☐ Failure messages distinguish unsupported inputs, invalid files, permissions, timeouts and internal failures.
- ☐ Temporary files and expired artifacts are cleaned up according to policy.
- ☐ Privacy disclosures, retention rules, terms, dependency licenses and external-provider policies have been reviewed.
- ☐ The benchmark and release gates are documented, repeatable, and passing.

# 15\. Open decisions

| **Decision**                  | **Recommended default**                                              | **Status / Final decision**                |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Product name and brand        | Keep Universal AI Workbench as an internal placeholder               | Before public branding/domain work         |
| Initial model provider        | Google Gemini (Gemini 2.5 Flash / Pro via `@ai-sdk/google`)          | **Finalized & Implemented**                |
| Queue/workflow technology     | Choose a durable queue with restart recovery and observable retries  | During Weeks 1–2 proof of concept          |
| Storage choice                | Supabase Storage (Private `artifacts` bucket, signed URLs, 50MB max) | **Finalized & Implemented**                |
| Maximum file sizes and quotas | Start conservative (50MB Supabase tier limit, per-tool limits)       | Profiled during tool development           |
| Exact 25–35 tool list         | 28 core launch tools mapped across 5 families                        | **Finalized in Section 5.3.1**             |
| Right Pane Studio Canvas      | Multi-family dynamic studio (Image, PDF, Data, Document)            | **Finalized in Section 5.5.1**             |
| Physical Resizer & BG Remover | Real-world units (cm, mm, in, DPI), Visa presets, and Alpha matting  | **Finalized in Section 5.3.2**             |
| Video URL sources             | Begin with one permitted, technically verified source workflow       | After API/terms feasibility review         |
| Pricing                       | Instrument costs and beta usage before choosing a credit model       | After closed beta data                     |
| Retention duration            | Set explicit defaults with user-facing disclosure                    | 30-day default retention policy            |
| Launch jurisdictions          | Start with intended markets and obtain relevant legal/privacy review | Before public beta                         |

# 16\. Risks and mitigations

| **Risk**                                | **Impact**  | **Mitigation / response**                                                                                       |
| --------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Tool breadth overwhelms quality         | High        | Ship a curated set, require tool-level tests, use capability flags and expand based on demand.                  |
| Native conversion incompatibility       | High        | Isolate engines, test real files, document fidelity limits, offer alternatives.                                 |
| AI chooses wrong tool or plan           | High        | Schema validation, constrained registry, clarification, plan budgets and deterministic checks.                  |
| Infrastructure costs grow unexpectedly  | High        | Quotas, resource limits, cost instrumentation, per-tool limits and anomaly alerts.                              |
| Security issue in file processing       | Critical    | Sandboxing, patching, no privileged execution, egress controls and incident response.                           |
| External API or platform policy changes | High        | Provider adapters, feature flags, documented fallback behavior and source-specific support.                     |
| Weak differentiation                    | High        | Measure verified completion, breadth, workflow success and interaction reduction against alternatives.          |
| Timeline underestimated                 | Medium–high | Prove risky engines early; treat roadmap as conditional and cut unsupported features rather than quality gates. |

# 17\. Glossary

| **Term**            | **Meaning**                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| Tool                | A registered, bounded operation such as compress PDF or resize image.          |
| Workflow            | A validated sequence or graph of tool steps and dependencies.                  |
| Task                | The user's overall requested unit of work and its persisted execution state.   |
| Step                | One invocation of a tool within a task.                                        |
| Artifact            | An uploaded, intermediate, or generated file tracked by the application.       |
| Artifact lineage    | Relationship between an output and the inputs/tasks that produced it.          |
| Verified completion | A result whose required technical and task-specific validation passed.         |
| Durable execution   | A job model whose state survives browser disconnects and worker restarts.      |
| SSRF                | Server-side request forgery; a risk when a backend fetches user-supplied URLs. |

# Appendix A — Example acceptance scenario

Request: "Compress this PDF under 2 MB, extract its tables into Excel, and summarize the document."

1. The user uploads a PDF that passes configured type and size checks.
2. The agent identifies the compression target and the three requested outcomes.
3. The server validates a plan that references only enabled tools.
4. Compression and content extraction execute from the immutable original when their dependencies allow it.
5. The compressed output is checked for valid PDF structure and target size; if the target cannot be met without violating quality constraints, the user is told rather than falsely promised success.
6. The extracted table data is converted into an XLSX workbook and checked for valid structure and expected worksheets/rows.
7. The summary is based on extracted document content; uncertainty or extraction failures are disclosed.
8. The artifacts are stored privately and associated with the task and source.
9. The chat shows each outcome separately, including partial failures, previews and authorized download actions.
10. After browser refresh, the same task and artifacts remain accessible to the owner without duplicate execution.

# Appendix B — Product decision rule

Add a capability only when its user value, technical feasibility, license, security posture, operational cost, and output verification are understood. Prefer a smaller set of reliable tools over a large catalog of nominally supported operations that cannot be validated.