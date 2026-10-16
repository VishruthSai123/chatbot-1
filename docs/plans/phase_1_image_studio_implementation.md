# Phase 1 Implementation Plan: Contextual Image Workbenches & Conversational Photo Pipeline

## 1. Executive Summary & Architectural Shift

### 1.1 The Core Problem with Monolithic Studios
The initial prototype attempted to mount a unified "Image Studio Canvas" that exposed every editing feature (resizing, passport presets, crop handles, DPI toggles, compression sliders, format converters, and background removal) simultaneously in a single side panel. 

This approach created significant product issues:
1. **Broken Conversational Value**: The AI chat became redundant because users were dropped into an overwhelming manual photo editor rather than an AI-driven workflow.
2. **Missing Chat-to-Workbench Link**: In the chat stream, tool outputs rendered bulky embedded previews rather than sleek, interactive artifact cards (like code and document artifacts in Vercel Chatbot).
3. **Broken Multi-Turn Editing**: Users had to re-upload files repeatedly instead of asking the AI to continuously refine the active image across conversation turns.
4. **Visual Clutter**: The UI felt noisy rather than clean, focused, and production-grade.

### 1.2 The New Product Architecture
Phase 1 re-architects the image workflow around **Progressive Disclosure**:
- **Chat is the Command Center**: The user talks to the AI. When a tool runs, the chat outputs a **minimal, sleek interactive card** detailing the exact operation and outcome.
- **Contextual Right Pane Inspectors**: Clicking the card or asking to refine opens a right pane focused **exclusively on the active tool** (e.g. *only* Compression controls if the user asked to compress; *only* Passport/Visa controls if the user asked to resize).
- **Conversational Memory & Image Chaining**: The output of Turn $N$ is automatically remembered in chat context as the input for Turn $N+1$.
- **Vercel-Grade Dark Mode Aesthetics**: Crisp 1px zinc borders, subtle neutral surfaces, zero tacky neon styling, and pixel-perfect component alignment.

---

## 2. Component Topology & File Structure

```
superiorai/
├── docs/
│   └── plans/
│       └── phase_1_image_studio_implementation.md  <-- (This Plan)
├── feature.md                                     <-- Master Feature Specification
├── components/
│   └── chat/
│       ├── message.tsx                            <-- Renders sleek in-chat tool result cards
│       ├── image-tool-card.tsx                    <-- Dedicated minimal artifact card for image tools
│       ├── artifact.tsx                           <-- Right pane container with toolMode router
│       └── image/                                 <-- Modular Tool Inspectors:
│           ├── image-workbench.tsx                <-- Container routing to active tool inspector
│           ├── compression-inspector.tsx          <-- Focused slider, target KB, live re-compress
│           ├── resizer-inspector.tsx              <-- Physical units, DPI, official passport presets
│           ├── crop-inspector.tsx                 <-- Aspect ratio locks, draggable boundary
│           └── background-removal-inspector.tsx   <-- Transparent checkerboard vs solid color backfill
├── artifacts/
│   └── image/
│       ├── client.tsx                             <-- Client artifact definition with inspector wiring
│       └── server.ts                              <-- Server-side artifact streaming & version persistence
├── lib/
│   ├── ai/
│   │   ├── prompts.ts                             <-- System prompt injecting active image context
│   │   └── tools/
│   │       └── image-tools.ts                     <-- Tool schemas with auto-fallback to active image
│   └── tools/
│       └── image/
│           ├── index.ts                           <-- Native Sharp & ONNX execution handlers
│           └── types.ts                           <-- Typed inputs & tool outputs
└── app/
    └── api/
        └── tools/
            └── image/
                └── route.ts                       <-- Direct API endpoint for inspector interactive tweaks
```

---

## 3. Detailed Architectural Specifications

### 3.1 In-Chat Interactive Tool Cards (`<ImageToolCard />`)

When the AI executes an image tool (`image_compress`, `image_resize_physical`, `image_crop`, `image_remove_bg`), `components/chat/message.tsx` renders a sleek, self-contained card instead of a raw preview or an error box:

#### Visual Blueprint:
```
┌────────────────────────────────────────────────────────────────────────┐
│ [Icon] Compressed Image                      1.42 MB → 184 KB (-87%)   │
│ ┌────────┐  document-photo.jpg                                         │
│ │ [Thumb]│  1200×1600 px • JPEG 80% • 300 DPI                         │
│ └────────┘                                                             │
│ [ ↗ Open Compression Controls ]                     [ ⬇ Download ]      │
└────────────────────────────────────────────────────────────────────────┘
```

#### Card Behavior:
1. **Interactive Trigger**: Clicking anywhere on the card or clicking `Open Controls` dispatches `setArtifact({ isVisible: true, documentId, kind: 'image', toolMode: 'compress' })`.
2. **Instant Download**: Direct download button allows users to grab the resulting image immediately without opening the side panel.
3. **Telemetry Row**: Displays format, dimensions, DPI, and size reduction percentage.
4. **State Transitions**:
   - `processing`: Muted loading pulse with descriptive status (`"Compressing photo to target 200 KB..."`).
   - `completed`: Interactive card with metrics badge.
   - `error`: Subtle destructive warning with actionable retry guidance.

---

### 3.2 Modular Contextual Inspectors (Right Pane)

The Right Pane mounts `<ImageWorkbench />`, which checks `artifact.toolMode` (or inspects the latest tool applied) and renders **only** the relevant inspector:

#### Inspector 1: Compression Inspector (`<CompressionInspector />`)
- **Activated By**: `image_compress` or conversational compression requests.
- **Preview**: Focused image preview with an optional Before/After split slider to evaluate visual compression artifacts.
- **Controls**:
  - Target size bound input (`[ 200 ] KB`).
  - Quality percentage slider (`0% - 100%`).
  - Output format switcher (`JPEG` / `WebP` / `PNG`).
  - Interactive "Re-compress" button calling `/api/tools/image` directly with instant feedback.
  - Download button with formatted filename (`photo-compressed-184kb.jpg`).

#### Inspector 2: Physical Resizer Inspector (`<ResizerInspector />`)
- **Activated By**: `image_resize_physical` or passport/visa sizing requests.
- **Preview**: High-resolution image canvas with physical overlay ticks (mm/inches).
- **Controls**:
  - Passport/Visa preset dropdown:
    - *Indian Passport / OCI* ($35\times45\text{ mm}$, 300 DPI)
    - *US Visa / Passport* ($2\times2\text{ in}$, 300 DPI)
    - *Schengen Visa* ($35\times45\text{ mm}$, 300 DPI)
    - *Indian PAN Card* ($25\times35\text{ mm}$, $\le 50\text{ KB}$)
    - *Stamp Size* ($20\times25\text{ mm}$)
  - Custom dimension inputs with unit switcher (`mm`, `cm`, `in`, `px`).
  - Target DPI density selector (`300 DPI` print, `150 DPI`, `72 DPI` web).
  - Calculated resolution output (e.g. `413 × 531 px`).

#### Inspector 3: Crop Inspector (`<CropInspector />`)
- **Activated By**: `image_crop` or cropping requests.
- **Preview**: Interactive cropping canvas with draggable corner handles and rule-of-thirds grid.
- **Controls**:
  - Aspect ratio presets (`Free`, `1:1 Square`, `4:5 Portrait`, `16:9 Landscape`, `3:2 Photo`).
  - Live pixel dimensions readout of the selected crop rectangle.
  - "Apply Crop" button that commits the crop and creates a new artifact version.

#### Inspector 4: Background Removal Inspector (`<BackgroundRemovalInspector />`)
- **Activated By**: `image_remove_bg` or background isolation requests.
- **Preview**: Rendered against a neutral dark checkerboard grid showing alpha transparency.
- **Controls**:
  - Mode toggle: **Transparent PNG** vs **Solid Color Backfill**.
  - Solid Color presets: Pure White (`#FFFFFF`, passport requirement), Light Grey (`#E5E7EB`), Studio Blue (`#1E3A8A`), or custom color picker.
  - Before/After toggle button to verify hair edge preservation and segmentation quality.

---

### 3.3 Continuous Conversational State & Image Chaining

To eliminate the frustrating requirement of re-uploading an image for each successive edit:

1. **Active Artifact Tracking in Context**:
   - The chat session maintains an `activeImageArtifact` reference in the conversation state.
   - When a user uploads an image or a tool generates an image output, `activeImageArtifact` is updated to point to the latest artifact ID and signed URL.

2. **System Prompt Injection**:
   - The AI system prompt is dynamically enriched with the active image context:
     ```
     Active Image in Context:
     - Artifact ID: "doc-123"
     - Storage URL: "https://...supabase.co/.../image.png"
     - Dimensions: 1200x1600 px
     - Format: png
     - File Size: 1.4 MB
     - Current Tool Applied: image_resize_physical
     When the user asks for subsequent modifications (e.g., "now remove background", "make it black and white", "compress it"), use the active image above as the input source. DO NOT ask the user to re-upload.
     ```

3. **Tool Input Fallback**:
   - If the user prompt does not include an explicit new image URL, the tool execution handler automatically falls back to `activeImageArtifact.url`.
   - The resulting output is saved as a new version in the document lineage (`parentArtifactId = previousArtifactId`).

---

## 4. Visual Design System (Vercel Chatbot Inspired)

All UI components must strictly adhere to the clean, production-grade Vercel aesthetic:
- **Color Palette**:
  - Backgrounds: `bg-background` (`zinc-950` in dark mode)
  - Cards & Sidebars: `bg-card` / `bg-zinc-900/60`
  - Borders: `border-border/50` / `border-zinc-800`
  - Typography: `text-zinc-100` (headings), `text-zinc-400` (labels/subtext)
  - Accents: Subtle blue/neutral focus rings (`focus:border-zinc-500`, `ring-zinc-700`)
- **Typography & Alignment**:
  - Monospace font for technical readouts: dimensions (`413×531 px`), file sizes (`184 KB`), DPI (`300 DPI`).
  - Compact padding: `px-3 py-2` on tool controls, `gap-2` for action buttons.
  - Zero arbitrary colorful gradients or saturated cartoon elements.

---

## 5. Step-by-Step Implementation Roadmap

### Milestone 1: In-Chat Minimal Tool Cards & Tool Execution Alignment
- [ ] Create `components/chat/image-tool-card.tsx` with thumbnail preview, telemetry badge, direct download, and "Open Inspector" action.
- [ ] Update `components/chat/message.tsx` to render `<ImageToolCard />` for all image tool calls and outputs.
- [ ] Ensure clicking the card dispatches `setArtifact` with the appropriate `toolMode`.

### Milestone 2: Modular Right Pane Tool Inspectors
- [ ] Create `components/chat/image/compression-inspector.tsx`.
- [ ] Create `components/chat/image/resizer-inspector.tsx`.
- [ ] Create `components/chat/image/crop-inspector.tsx`.
- [ ] Create `components/chat/image/background-removal-inspector.tsx`.
- [ ] Create `components/chat/image/image-workbench.tsx` to host and switch between inspectors based on `toolMode`.
- [ ] Wire `<ImageWorkbench />` into `artifacts/image/client.tsx`.

### Milestone 3: Continuous Conversational State & Image Chaining
- [ ] Inject `activeImageArtifact` metadata into the chat system prompt in `app/(chat)/api/chat/route.ts`.
- [ ] Update tool definitions in `lib/ai/tools/image-tools.ts` to automatically default `source` to the conversation's active image.
- [ ] Test multi-turn conversational edits (e.g. Upload $\rightarrow$ Resize to Passport $\rightarrow$ Remove Background $\rightarrow$ Compress to 50KB) without re-uploading.

### Milestone 4: Direct Interactive Re-computation API
- [ ] Ensure `/api/tools/image` supports rapid interactive adjustments directly from the Right Pane inspectors (adjusting compression slider or changing background color without requiring a full LLM turn).
- [ ] Maintain version history in Supabase Storage with parent lineage tracking.

### Milestone 5: Verification & Quality Assurance
- [ ] Verify TypeScript compiles with 0 errors (`pnpm exec tsc --noEmit`).
- [ ] Verify production build compiles with 0 errors (`pnpm run build`).
- [ ] Confirm all 11 serverless functions deploy within Vercel Hobby limits.
