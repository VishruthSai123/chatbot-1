# Family 01: Image Processing & Photo Pipeline Rulebook

## 1. Family Scope & Core Philosophy

The Image family delivers deterministic, hardware-accelerated image operations and photo processing designed for real-world document specifications, official identity compliance, and creative refinement.

### Fundamental Philosophy: Conversational-First, Contextual-Second
- **Chat is the Command Center**: Users state their desired outcome conversationally.
- **Minimal In-Chat Cards**: Operations output clean, compact interactive cards with telemetry (dimensions, file size, reduction ratio) and direct download/inspect actions.
- **Contextual Workbenches, NOT Kitchen-Sink Studios**: The right pane inspector opens specifically for the active tool (e.g. *only* Compression controls if the user requested compression; *only* Passport/Visa controls if the user requested resizing).
- **Multi-Turn State Propagation**: Images are tracked in conversation context. Users never have to re-upload files to apply successive transformations.
- **Native Execution**: Zero third-party SaaS APIs. Powered by native `sharp` (libvips) and `@imgly/background-removal-node` with ONNX Runtime.

---

## 2. Tool Registry & Contextual Inspectors

### 2.1 `image_compress` $\rightarrow$ Compression Inspector
- **Conversational Triggers**: *"compress this photo"*, *"make it under 200 KB"*, *"reduce file size"*, *"optimize image"*.
- **Tool Logic**: Native Sharp JPEG/WebP/PNG compression targeting exact byte bounds.
- **Inspector UI (`<CompressionInspector />`)**:
  - Live target size input (KB).
  - Quality percentage slider (1% to 100%).
  - Format toggle (JPEG, WebP, PNG).
  - Before vs After comparison slider.
  - Interactive "Re-compress" action and direct download.

### 2.2 `image_resize_physical` $\rightarrow$ Physical Resizer Inspector
- **Conversational Triggers**: *"make this passport size"*, *"resize for US visa"*, *"35x45mm at 300 DPI"*, *"PAN card size"*.
- **Government Presets**:
  | Preset Key | Description | Width × Height | DPI | Aspect |
  | :--- | :--- | :--- | :--- | :--- |
  | `indian_passport` | Indian Passport / OCI | 35 × 45 mm | 300 | 7:9 |
  | `us_visa` | US Visa / Passport | 2 × 2 in | 300 | 1:1 |
  | `schengen_visa` | Schengen Visa | 35 × 45 mm | 300 | 7:9 |
  | `pan_card` | Indian PAN Card | 25 × 35 mm (≤ 50 KB) | 300 | 5:7 |
  | `stamp_size` | Stamp Size Photo | 20 × 25 mm | 300 | 4:5 |
- **Inspector UI (`<ResizerInspector />`)**:
  - Government preset selector.
  - Physical unit switcher (`mm`, `cm`, `in`, `px`).
  - Target DPI density selector (`300`, `150`, `72`).
  - Resulting pixel dimension readout.

### 2.3 `image_crop` $\rightarrow$ Crop Inspector
- **Conversational Triggers**: *"crop to square"*, *"crop face"*, *"make it 16:9"*, *"crop out the edges"*.
- **Tool Logic**: Bounding box extraction with pixel-perfect coordinates.
- **Inspector UI (`<CropInspector />`)**:
  - Aspect ratio selector (`Free`, `1:1`, `4:5`, `16:9`, `3:2`).
  - Draggable corner and edge crop handles on canvas.
  - Live pixel dimensions readout.
  - "Apply Crop" button.

### 2.4 `image_remove_bg` $\rightarrow$ Background Removal Inspector
- **Conversational Triggers**: *"remove background"*, *"transparent background"*, *"white background for visa"*.
- **Tool Logic**: Neural portrait/subject segmentation via `@imgly/background-removal-node`.
- **Inspector UI (`<BackgroundRemovalInspector />`)**:
  - Mode toggle: **Transparent (PNG)** vs **Solid Color Backfill**.
  - Color swatches: Pure White (`#FFFFFF`), Light Grey (`#E5E7EB`), Studio Blue (`#1E3A8A`), or custom color picker.
  - Before/After toggle button to evaluate hair/edge isolation.

---

## 3. Conversational State Machine & Image Chaining

1. **Context Registration**:
   - Every uploaded image and tool output registers in chat context:
     `activeImage = { id, storageUrl, width, height, format, sizeBytes, activeTool }`.
2. **Multi-Turn Continuity**:
   - The AI agent prompt receives `activeImage`.
   - When the user asks for subsequent edits without providing a new file, the AI uses `activeImage.storageUrl` as the input source.
   - Derived artifacts record `parentArtifactId` to maintain complete version lineage.
3. **Inspector Synchronization**:
   - When a new tool completes in chat, the Right Pane transitions smoothly to the corresponding inspector.
   - Using the Right Pane inspector to tweak values (e.g. dragging the compression slider) persists changes back to the active artifact version.

---

## 4. UI Design Standards: Vercel Chatbot Inspired

- **Aesthetic**: Minimal, clean, monochromatic dark mode.
- **Palette**: `zinc-950` backgrounds, `zinc-900` card surfaces, `zinc-800` subtle dividers, `zinc-100` headings, `zinc-400` secondary text.
- **Typography**: Clean sans-serif for UI labels, monospace for technical metadata (dimensions, DPI, file sizes).
- **No Vibe-Coded Clutter**: No loud saturated gradients, giant floating emojis, or rainbow neon styling.
