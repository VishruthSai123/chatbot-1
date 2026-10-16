# Phase 1 Implementation Plan: Native Image Studio & Advanced Photo Pipeline

## 1. Executive Summary & Objective
Phase 1 transforms the template's basic static image preview into a **professional-grade, hardware-accelerated Image Studio**. This includes:
1. **Server-Side Native Engine**: Powered by `sharp` for pixel-perfect resizing, cropping, rotation, format conversion, and DPI density injection.
2. **Physical Photo Resizer (`image_resize_physical`)**: Mathematical conversion of real-world units (`cm`, `mm`, `in`) to pixels with strict passport and visa presets (Indian Passport $35\times45\text{ mm}$, US Visa $2\times2\text{ in}$, Schengen $35\times45\text{ mm}$, Stamp size, PAN card).
3. **Native Background Remover (`image_remove_bg`)**: Zero-SaaS neural segmentation via `@imgly/background-removal-node` (running locally via ONNX) with alpha transparency (PNG) and solid color backfill (`#FFFFFF` for passport compliance).
4. **Interactive Right Pane Studio Canvas (`<ImageStudioCanvas />`)**: Full-featured interactive HTML5 canvas supporting Pan, Zoom ($10\% - 500\%$), draggable Crop handles with aspect-ratio locks, physical unit controls, DPI toggle, 1-click background removal, and a Before/After comparison slider.
5. **Dual-Sync Execution**: Invocable either conversationally through chat prompts or directly via 1-click controls in the Right Pane Studio without requiring an LLM round-trip.

---

## 2. Target File Topology

```
superiorai/
├── docs/
│   └── plans/
│       └── phase_1_image_studio_implementation.md  <-- (This Document)
├── lib/
│   ├── image/
│   │   ├── native.ts             <-- Core Sharp processing functions & math
│   │   ├── presets.ts            <-- Visa & Passport physical dimension specs
│   │   └── background-removal.ts <-- Neural segmentation pipeline
│   ├── tools/
│   │   └── image/
│   │       ├── index.ts          <-- Registered tool handlers with Zod schemas
│   │       └── types.ts          <-- Tool inputs & outputs
│   └── ai/
│       └── tools/
│           └── image-tools.ts    <-- Gemini AI agent tool wrappers for chat
├── app/
│   └── api/
│       └── tools/
│           └── image/
│               └── route.ts      <-- Direct API endpoint for Right Pane Canvas actions
├── components/
│   └── chat/
│       ├── image-studio-canvas.tsx <-- Interactive HTML5 Canvas, Crop, Zoom, Pan
│       ├── image-controls.tsx    <-- Physical units bar, presets, DPI switcher
│       └── before-after-slider.tsx <-- Interactive comparison slider
└── artifacts/
    └── image/
        ├── client.tsx            <-- Upgraded imageArtifact with studio controls
        └── server.ts            <-- Server-side artifact handler for streaming/updates
```

---

## 3. Dependencies & Installation Plan

```bash
pnpm add sharp @imgly/background-removal-node
pnpm add -D @types/sharp
```

### Dependency Guardrails:
- `sharp`: Uses pre-compiled libvips platform binaries. Compatible with Vercel Serverless (Linux x64) and Windows local development.
- `@imgly/background-removal-node`: Runs ONNX segmentation locally in Node.js runtime with zero external API calls or billing tokens.

---

## 4. Step-by-Step Implementation Breakdown

### Step 1: Core Mathematical Engine & Presets (`lib/image/presets.ts`)

#### Physical Dimension Standards Table:
| Preset Key | Display Name | Width | Height | Unit | Default DPI | Resulting Px | Target Aspect | Requirements |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `indian_passport` | Indian Passport / OCI | 35 | 45 | mm | 300 | $413 \times 531$ | $7:9$ | Plain light/white background, 70-80% face coverage |
| `us_visa` | US Visa / Passport | 2 | 2 | in | 300 | $600 \times 600$ | $1:1$ | Plain white background, $1\text{ in} - 1\frac{3}{8}\text{ in}$ head size |
| `schengen_visa` | Schengen Visa | 35 | 45 | mm | 300 | $413 \times 531$ | $7:9$ | Light grey/white background |
| `uk_visa` | UK / Australian Visa | 35 | 45 | mm | 300 | $413 \times 531$ | $7:9$ | Cream/light grey background |
| `stamp_size` | Stamp Size | 20 | 25 | mm | 300 | $236 \times 295$ | $4:5$ | Compact ID photo |
| `pan_card` | Indian PAN Card | 25 | 35 | mm | 300 | $295 \times 413$ | $5:7$ | Strict file size limit $\le 50\text{ KB}$ |
| `photo_4x6` | Standard 4x6 Print | 4 | 6 | in | 300 | $1200 \times 1800$ | $2:3$ | High-resolution lab print |

#### Mathematical Conversion Formula:
$$\text{Pixels} = \begin{cases} \text{round}\left(\frac{\text{dim}_{\text{mm}}}{25.4} \times \text{DPI}\right) & \text{if unit is mm} \\ \text{round}\left(\frac{\text{dim}_{\text{cm}} \times 10}{25.4} \times \text{DPI}\right) & \text{if unit is cm} \\ \text{round}\left(\text{dim}_{\text{in}} \times \text{DPI}\right) & \text{if unit is in} \\ \text{dim} & \text{if unit is px} \end{cases}$$

---

### Step 2: Native Sharp Execution (`lib/image/native.ts`)

Implement pure in-memory Buffer transformations:
1. `resizePhysicalImage(buffer, widthMm, heightMm, dpi, format)`:
   - Scales to target pixel dimensions.
   - Embeds JFIF/EXIF density metadata: `.withMetadata({ density: dpi })`.
2. `cropImage(buffer, left, top, width, height)`:
   - Extracts bounding box region without interpolation distortion.
3. `rotateImage(buffer, angle, flipH, flipV)`:
   - Rotates by 90/180/270 degrees and flips horizontally/vertically.
4. `compressImage(buffer, targetSizeKb, quality, format)`:
   - Iterative or quality-calibrated compression targeting exact byte bounds.
5. `convertImage(buffer, targetFormat)`:
   - Transforms between `jpeg`, `png`, `webp`, `avif`.
6. `getImageMetadata(buffer)`:
   - Returns width, height, density (DPI), channels, format, color space.

---

### Step 3: Native Background Removal Pipeline (`lib/image/background-removal.ts`)

1. **Neural Segmentation**:
   - Converts input buffer to Blob and passes into `@imgly/background-removal-node`.
   - Produces 32-bit RGBA PNG with alpha channel transparency.
2. **Solid Color Composite Backfill**:
   - If user selects `mode: 'solid_color'`, generates a pure color canvas using `sharp({ create: { width, height, channels: 4, background: hexColor } })`.
   - Composites transparent foreground onto background: `.composite([{ input: foregroundBuffer, blend: 'over' }])`.
   - Returns high-quality JPEG or PNG.

---

### Step 4: Deterministic Tools & Zod Validation (`lib/tools/image/`)

Each tool implements a standardized contract:
- Validates parameters via Zod (`z.object({ ... })`).
- Downloads original artifact from Supabase Storage (`downloadArtifact`).
- Executes deterministic native transformation.
- Validates output buffer (decodable, matches dimensions and MIME).
- Saves derived artifact to Supabase Storage with `parentArtifactId` lineage.
- Returns `{ artifactId, signedUrl, width, height, dpi, sizeBytes }`.

---

### Step 5: Direct API Endpoint (`app/api/tools/image/route.ts`)

Allows the Right Pane Studio UI to execute actions instantaneously:
- `POST /api/tools/image`:
  - Body: `{ action: 'resize_physical' | 'remove_bg' | 'crop' | 'rotate', artifactId, params }`.
  - Authenticates user session.
  - Verifies artifact ownership.
  - Executes tool and returns updated artifact metadata and signed URL.

---

### Step 6: Gemini AI Tool Definitions (`lib/ai/tools/image-tools.ts`)

Exposes conversational tools to the Gemini 2.5 agent:
- `image_resize_physical`: Prompt examples: *"make this 35x45mm at 300 DPI"*, *"resize to US visa specifications"*.
- `image_remove_bg`: Prompt examples: *"remove background"*, *"make background transparent"*, *"change background to white"*.
- `image_crop`: Prompt examples: *"crop to square"*, *"crop top half"*.
- `image_compress`: Prompt examples: *"compress under 50KB for passport portal upload"*.

---

### Step 7: Interactive Right Pane Canvas (`components/chat/image-studio-canvas.tsx`)

A rich, interactive React component rendering inside the Right Pane:
1. **Viewport & Zoom Engine**:
   - Canvas surface with mouse-wheel zoom ($10\% - 500\%$) centered on cursor.
   - Click-and-drag panning with grab/grabbing cursor.
   - "Fit to Screen" and "100% Actual Size" quick zoom buttons.
2. **Interactive Crop Overlay**:
   - 8 draggable anchor handles (top-left, top-right, bottom-left, bottom-right, and 4 edges).
   - Dimmed semi-transparent outer backdrop ($rgba(0,0,0,0.6)$).
   - Rule-of-thirds grid lines inside crop rectangle.
   - Aspect ratio locking toggle: Freeform, 1:1, 4:5, 16:9, Passport (7:9).
3. **Physical Units Toolbar (`components/chat/image-controls.tsx`)**:
   - Unit toggle buttons: `px` | `cm` | `mm` | `in`.
   - DPI selector pills: `72` | `150` | `300` (default) | `600`.
   - Preset selector dropdown: Instant fill of dimensions and DPI.
   - Live Dimension Readout: `35.0 × 45.0 mm (413 × 531 px @ 300 DPI)`.
4. **Background Removal Panel**:
   - Pinned **"Remove Background"** action button with spinner state.
   - Mode switch: "Transparent (Checkerboard)" vs "Solid Fill".
   - Color picker with swatches: White (`#FFFFFF`), Light Grey (`#E2E8F0`), Off-White (`#F8FAFC`), Studio Blue (`#0066CC`).
5. **Before/After Split Comparison Slider (`components/chat/before-after-slider.tsx`)**:
   - Side-by-side or split-view divider dragging across image to compare original vs processed.
6. **Action Toolbar**:
   - Rotate $90^\circ$ Clockwise / Counter-Clockwise.
   - Flip Horizontal / Vertical.
   - Reset Changes.
   - "Apply & Save as Version".
   - Download (PNG, JPEG, WEBP).

---

### Step 8: Upgrading Artifact Definition (`artifacts/image/client.tsx`)

Replaces the basic `ImageEditor` with the new `<ImageStudioCanvas />`:
- Registers client toolbar actions (Undo, Redo, Copy, Download, Toggle Studio).
- Binds to `useArtifact` global state.
- Supports streaming deltas and live updates.

---

## 5. Memory & Performance Guardrails

1. **Buffer Lifecycle**: Avoid keeping raw image buffers in memory after upload. Stream directly to Supabase Storage and release GC references.
2. **Sharp Concurrency**: Set `sharp.concurrency(1)` in serverless functions to prevent thread starvation under concurrent requests.
3. **Canvas Offscreen Rendering**: For large 4K+ images, compute transforms using an OffscreenCanvas or display a scaled preview while the final high-res output is rendered losslessly by `sharp` on the server.
4. **Strict Upload Quota**: Reject uploads $> 50\text{ MB}$ at the API gateway before Sharp decoding.

---

## 6. End-to-End Acceptance Checklist

- [ ] `image_resize_physical` converts $35\times45\text{ mm}$ at 300 DPI into exactly $413 \times 531\text{ px}$.
- [ ] Output JPEG/PNG files contain verified JFIF/EXIF density tags equal to target DPI.
- [ ] Indian Passport, US Visa ($2\times2\text{ in} = 600\times600\text{ px}$), Schengen Visa, Stamp, and PAN card presets produce valid outputs.
- [ ] `image_remove_bg` produces a 32-bit RGBA PNG with transparent alpha background.
- [ ] `image_remove_bg` with `solid_color: '#ffffff'` creates a clean white background.
- [ ] Right Pane `<ImageStudioCanvas />` supports smooth Pan, Zoom, and Crop overlay.
- [ ] Clicking "Remove Background" in the Right Pane executes natively and updates canvas preview.
- [ ] Derived artifacts are saved in Supabase Storage with verified parent lineage.
- [ ] Chat conversation displays result card and synchronizes with Right Pane.
- [ ] Production build (`pnpm run build`) and type check (`npx tsc --noEmit`) pass with 0 errors.
