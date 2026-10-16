# Universal AI Workbench: Product & Feature Specification

## 1. Executive Vision & Core Philosophy

The **Universal AI Workbench** is a conversational AI toolbox and autonomous work assistant inspired by the clean, modern, and production-grade design language of the **Vercel AI Chatbot**.

### 1.1 The Fundamental Paradigm: Conversational Command Center + Contextual Workbenches
The platform solves digital task fragmentation by letting users state their intended outcome in natural language rather than hunting through disjointed SaaS utilities.

#### The Anti-Pattern: The "Kitchen-Sink Studio"
Placing every tool (resize, crop, rotate, compress, convert, background removal) simultaneously into an all-in-one canvas sidebar destroys the conversational value of AI. When a user asks:
> *"Compress this image to 200 KB"*

They do **not** want to be dumped into a complex photo editor displaying passport dropdowns, crop handles, DPI switchers, and background removal toggles. Doing so makes the chat interface and AI integration irrelevant.

#### The Correct Model: Progressive, Intent-Specific Contextual Workbenches
1. **Chat as the Primary Command Center**: The user interacts with the AI naturally. The AI analyzes the intent, executes the appropriate native tool, and emits a **sleek, minimal interactive artifact card** directly into the conversation stream.
2. **Minimal In-Chat Artifact Cards**: Similar to how code generation outputs a compact, clickable code artifact block, image operations render an informative, lightweight card in the chat (showing thumbnail, operation summary, dimension/size deltas, and an action button).
3. **Intent-Specific Right Pane**: Clicking the in-chat card (or asking the AI to inspect/adjust) opens the right pane focused **exclusively on that specific tool**:
   - **Compress Request** $\rightarrow$ **Compression Inspector**: Displays before/after file size, percentage saved, an interactive quality/size slider to re-compress in real-time, and a direct download button.
   - **Resize / Visa Request** $\rightarrow$ **Physical Resizer Inspector**: Displays physical dimensions (mm/in/cm), target DPI, preset requirements, and aspect bounds.
   - **Crop Request** $\rightarrow$ **Crop Inspector**: Displays aspect-ratio selector (1:1, 4:5, 16:9, Free), draggable crop handles, and an apply button.
   - **Remove Background Request** $\rightarrow$ **Background Remover Inspector**: Displays transparency checkerboard view, background color backfill swatches, and edge tolerance controls.
4. **Continuous Conversational Chaining (Stateful Multi-Turn)**:
   - The user **never** has to re-upload an image for subsequent modifications.
   - The output of Turn $N$ becomes the immediate active input for Turn $N+1$.
   - Example multi-turn flow:
     - *Turn 1*: "Compress this photo to under 100 KB" $\rightarrow$ AI compresses it, chat shows compression card, right pane shows Compression Inspector.
     - *Turn 2*: "Now remove the background" $\rightarrow$ AI automatically uses the compressed image from Turn 1, performs neural background removal, emits a Background Removal card in chat, and switches the right pane to the Background Remover Inspector.
     - *Turn 3*: "Crop it to 1:1 square" $\rightarrow$ AI applies crop to the transparent result.

---

## 2. In-Chat Artifact Architecture

### 2.1 Design Philosophy: Vercel Chatbot Inspired
- **Visuals**: Modern, minimalist, monochromatic dark mode (`zinc-950` backgrounds, `zinc-900` cards, `zinc-800` borders, `zinc-200` text).
- **No Gimmicky Vibe-Coded Aesthetics**: Zero neon glows, saturated rainbow gradients, or oversized animated widgets. Every border is a precise 1px subtle divider (`border-border/50` or `zinc-800`).
- **Interactive Feedback**: Crisp micro-animations, clean loading spinners, and instant visual state transitions.

### 2.2 Minimal In-Chat Tool Cards

When an image tool executes, the chat stream renders a dedicated, compact card:

```
┌─────────────────────────────────────────────────────────────┐
│ 🗜️ Compressed Image                    1.4 MB → 184 KB (-87%)│
│ ┌─────┐  photo-final.jpg                                    │
│ │ img │  1920×1080 px • JPEG 82% quality                   │
│ └─────┘                                                     │
│ [ ↗ Open Compression Inspector ]           [ ⬇ Download ]    │
└─────────────────────────────────────────────────────────────┘
```

- **Thumbnail Preview**: Small, crisp 48×48px or 64×64px thumbnail with rounded corners and border.
- **Key Metrics Badge**: Clear before $\rightarrow$ after metrics (e.g., file size reduction, physical dimension changes).
- **Click-to-Open Action**: Clicking the card or the "Open Inspector" action smoothly slides out the right pane focused specifically on that tool.
- **Direct Download**: Fast action to download the result without needing to open the side pane if satisfied.

---

## 3. Modular Right Pane Inspectors

Instead of a monolithic canvas, the right pane mounts an **Inspector Controller** that renders the exact workbench required by the active tool:

```
┌─────────────────────────────────────────────────────────────┐
│ Right Pane Header: [Tool Title]          [Revert] [Close ✕]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    Focused Preview Area                     │
│               (Clean Canvas with Pan/Zoom)                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Dedicated Tool Control Panel:                               │
│ - If Compression: [Quality Slider] [Target KB] [Recompress] │
│ - If Physical Resize: [Preset Select] [W × H] [DPI Switch]  │
│ - If Crop: [Aspect Ratio Grid] [Active Drag Area] [Apply]   │
│ - If Remove BG: [Checkerboard/Solid Color] [Color Swatches] │
├─────────────────────────────────────────────────────────────┤
│ Bottom Bar: [File Telemetry: Dimensions, DPI, Size] [Save]  │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Compression Inspector (`<CompressionInspector />`)
- **Primary Goal**: Allow the user to fine-tune file size and visual fidelity.
- **Controls**:
  - Live target size input (e.g. `200` KB).
  - Quality percentage slider ($1\% - 100\%$).
  - Format toggle (`JPEG`, `WebP`, `PNG`).
  - Instant "Re-compress" button running natively on the server.
  - Before/After split slider to inspect compression artifacts.

### 3.2 Physical Resizer Inspector (`<ResizerInspector />`)
- **Primary Goal**: Ensure photos comply with strict physical print specifications (passports, visas, ID cards).
- **Controls**:
  - Government preset selector (`Indian Passport 35×45mm`, `US Visa 2×2in`, `Schengen Visa`, `PAN Card`, `Stamp`).
  - Custom dimension inputs with unit selector (`mm`, `cm`, `in`, `px`).
  - DPI density selector (`300 DPI` print standard, `150 DPI`, `72 DPI` web).
  - Output dimension calculator showing exact resulting pixel resolution.

### 3.3 Crop Inspector (`<CropInspector />`)
- **Primary Goal**: Framing, composition, and aspect ratio alignment.
- **Controls**:
  - Aspect ratio locks (`Free`, `1:1 Square`, `4:5 Portrait`, `16:9 Landscape`, `3:2 Photo`).
  - Interactive on-canvas crop boundary with corner and edge drag handles.
  - Pixel readout of cropped region.
  - "Apply Crop" action that produces a new version in the history.

### 3.4 Background Removal Inspector (`<BackgroundRemovalInspector />`)
- **Primary Goal**: Foreground extraction and official background backfills.
- **Controls**:
  - Mode toggle: **Transparent (PNG)** vs **Solid Color**.
  - Color palette: White (`#FFFFFF`, passport requirement), Light Grey (`#E5E7EB`), Off-White (`#F9FAFB`), or Custom Hex color picker.
  - Before/After toggle button to verify hair edge preservation and segmentation quality.

---

## 4. Multi-Turn Conversational State Machine

### 4.1 The Image Context Chain
In conversational photo editing, losing context across turns is fatal to user experience. The system implements an explicit **Artifact Lineage Chain**:

1. **Upload / Turn 1**:
   - User uploads `portrait.jpg` and asks: *"Resize this for Indian passport"*.
   - System creates `Artifact` record `A1` (`kind: 'image'`, `tool: 'image_resize_physical'`).
   - Chat context stores `activeImageArtifactId = A1.id`.
2. **Turn 2**:
   - User says: *"Now remove the background and make it white"*.
   - The AI agent's system prompt includes the ID, URL, dimensions, and format of `A1`.
   - The AI invokes `image_remove_bg` with `source: A1.storageUrl` and `mode: 'solid_color'`, `backgroundColor: '#FFFFFF'`.
   - System creates derived `Artifact` record `A2` with `parentArtifactId = A1.id`.
   - Chat renders the new tool result card for `A2`.
   - The right pane smoothly transitions its inspector to the Background Removal view.
3. **Turn 3**:
   - User says: *"Make sure it is under 50 KB for the portal upload"*.
   - AI invokes `image_compress` with `source: A2.storageUrl` and `targetSizeKb: 50`.
   - System creates `A3` with `parentArtifactId = A2.id`.
   - Right pane switches to the Compression Inspector.

### 4.2 Reversion & Version Navigation
- The user can step backward and forward through versions (`Undo` / `Redo`) via the artifact header.
- Switching versions updates both the right pane preview and the conversational active context.

---

## 5. Architectural Quality Attributes

1. **Zero External SaaS APIs**:
   - Server-side image manipulation runs purely on native `sharp` (libvips C-bindings).
   - Neural background removal runs on-device using `@imgly/background-removal-node` with ONNX Runtime.
   - Storage is managed privately via Supabase Storage buckets with short-lived signed URLs.
2. **Deterministic & Bounded Execution**:
   - Serverless functions are strictly guarded to execute within AWS Lambda memory (1024 MB) and time bounds (15s).
   - Large images ($> 20\text{ MB}$) are pre-validated before processing.
3. **Vercel Hobby Serverless Compliance**:
   - Total serverless function count is kept strictly $\le 11$ (under the 12-function Hobby plan limit).
   - Dependency hoisting and external package declarations ensure native binaries bundle under Lambda's 50 MB compressed ceiling.
