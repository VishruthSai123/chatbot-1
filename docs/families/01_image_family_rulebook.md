# Family 01: Image Studio & Advanced Photo Tools Rulebook

## 1. Family Scope & Core Philosophy
The Image Studio family provides professional-grade raster image processing, photo resizing for official print/visa specifications, format conversion, and background removal without relying on external SaaS APIs. 

### Native Stack
- **Server Engine**: `sharp` (high-performance libvips node wrapper).
- **Background Removal**: `@imgly/background-removal-node` / native client-side canvas segmentation.
- **Client Studio Canvas**: Hardware-accelerated HTML5 Canvas with Pan, Zoom, Interactive Crop Overlay, and Before/After Split Comparison.
- **Storage**: Private Supabase Storage bucket (`artifacts`) with signed URLs.

---

## 2. Active Tools Specification

### 2.1 `image_resize_physical` (Photo Resizer for Official Documents)
Resizes images based on real-world physical units (`cm`, `mm`, `in`) with explicit DPI metadata tagging.

#### Conversion Mathematics:
$$\text{Target Width (px)} = \frac{\text{Width (mm)}}{25.4} \times \text{DPI}$$
$$\text{Target Height (px)} = \frac{\text{Height (mm)}}{25.4} \times \text{DPI}$$
$$\text{Target Width (px)} = \text{Width (in)} \times \text{DPI}$$

#### Government & Visa Standard Presets:
| Preset | Physical Size | Standard DPI | Dimensions (px) | Aspect Ratio | Requirements |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Indian Passport / OCI** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Plain light/white background, 70-80% face coverage |
| **US Visa / US Passport** | $2\text{ in} \times 2\text{ in}$ ($50.8 \times 50.8\text{ mm}$) | 300 DPI | $600 \times 600\text{ px}$ | $1:1$ | Plain white background, head height $1\text{ in} - 1\frac{3}{8}\text{ in}$ |
| **Schengen Visa** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Light grey/white background, neutral expression |
| **UK / Australian Visa** | $35\text{ mm} \times 45\text{ mm}$ | 300 DPI | $413 \times 531\text{ px}$ | $7:9$ | Cream/light grey background, clear border |
| **Stamp Size** | $20\text{ mm} \times 25\text{ mm}$ | 300 DPI | $236 \times 295\text{ px}$ | $4:5$ | Compact ID/certificate photos |
| **Indian PAN Card** | $25\text{ mm} \times 35\text{ mm}$ | 300 DPI | $295 \times 413\text{ px}$ | $5:7$ | Strict file size requirement $\le 50\text{ KB}$ |
| **Standard 4x6 Photo** | $4\text{ in} \times 6\text{ in}$ | 300 DPI | $1200 \times 1800\text{ px}$ | $2:3$ | High-resolution lab print |

#### Native `sharp` Implementation:
```typescript
import sharp from "sharp";

export async function resizeImagePhysical({
  inputBuffer,
  widthMm,
  heightMm,
  dpi = 300,
  format = "jpeg",
}: {
  inputBuffer: Buffer;
  widthMm: number;
  heightMm: number;
  dpi?: number;
  format?: "jpeg" | "png" | "webp";
}): Promise<Buffer> {
  const widthPx = Math.round((widthMm / 25.4) * dpi);
  const heightPx = Math.round((heightMm / 25.4) * dpi);

  return await sharp(inputBuffer)
    .resize(widthPx, heightPx, {
      fit: "cover",
      position: "centre",
    })
    .withMetadata({
      density: dpi, // Writes DPI into JFIF/EXIF headers
    })
    .toFormat(format, { quality: 95 })
    .toBuffer();
}
```

---

### 2.2 `image_remove_bg` (Native Background Removal)
Segments the primary foreground subject (portrait, product, document) and removes or replaces the background.

#### Invocation Triggers:
1. **Conversational Prompt**: *"remove the background"*, *"make background transparent"*, *"change background to pure white"*.
2. **Right Pane Studio Button**: Direct 1-click **"Remove Background"** button pinned to the Image Studio toolbar.

#### Modes:
- `transparent`: Produces a 32-bit RGBA PNG with an intact alpha channel. Rendered in the UI against an industry-standard neutral checkerboard grid.
- `solid_color`: Fills the segmented background with a specified hex/RGB color (default `#FFFFFF` for official passport requirements).

#### Native Implementation Logic:
```typescript
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

export async function removeImageBackground({
  inputBuffer,
  mode = "transparent",
  backgroundColor = "#ffffff",
}: {
  inputBuffer: Buffer;
  mode?: "transparent" | "solid_color";
  backgroundColor?: string;
}): Promise<Buffer> {
  // 1. Native neural segmentation (runs locally in Node runtime via ONNX)
  const blob = new Blob([inputBuffer]);
  const resultBlob = await removeBackground(blob, {
    output: { format: "image/png", quality: 0.95 },
  });
  const transparentPngBuffer = Buffer.from(await resultBlob.arrayBuffer());

  if (mode === "transparent") {
    return transparentPngBuffer;
  }

  // 2. Solid color composite backfill using sharp
  const metadata = await sharp(transparentPngBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 800;

  const backgroundLayer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: backgroundColor,
    },
  }).png().toBuffer();

  return await sharp(backgroundLayer)
    .composite([{ input: transparentPngBuffer, blend: "over" }])
    .jpeg({ quality: 95 })
    .toBuffer();
}
```

---

### 2.3 Other Core Image Operations
- `image_resize`: Pixel-based resizing (`width`, `height`, `fit: 'cover' | 'contain' | 'fill'`).
- `image_crop`: Sub-region extraction using coordinates (`left`, `top`, `width`, `height`).
- `image_rotate`: Rotation by 90/180/270 degrees and horizontal/vertical flips.
- `image_compress`: Compresses to a target file size in KB or target quality percentage (`1-100`).
- `image_convert`: Converts among `jpeg`, `png`, `webp`, `avif`, `tiff`.
- `image_get_metadata`: Extracts dimensions, color space, DPI density, channels, and format.

---

## 3. Dynamic Right Pane: Image Studio Canvas (`artifacts/image/client.tsx`)

The Right Pane mounts `<ImageStudioCanvas />` whenever an image artifact is active:

```
+---------------------------------------------------------------------------------------------------+
| Dynamic Image Studio Canvas                                                                       |
+---------------------------------------------------------------------------------------------------+
| [Toolbar: Zoom (10%-500%) | Pan Tool | Crop Overlay | Preset Dropdown | BG Remover | Export PNG]  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|               +-------------------------------------------+                                       |
|               |  Interactive HTML5 Canvas                 |                                       |
|               |                                           |                                       |
|               |    [Crop Handles Overlay]                 |                                       |
|               |    ┌──────────────┬──────────────┐        |                                       |
|               |    │              │              │        |                                       |
|               |    ├──────────────┼──────────────┤        |                                       |
|               |    │              │ 35 x 45 mm   │        |                                       |
|               |    └──────────────┴──────────────┘        |                                       |
|               |                                           |                                       |
|               +-------------------------------------------+                                       |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
| Physical Units: [px] [cm] [mm] [in] | DPI: [72] [150] [300] [600] | Presets: [Indian Passport ▼]   |
| Status: 413 x 531 px @ 300 DPI | File: passport_photo.jpg (124 KB)                                |
+---------------------------------------------------------------------------------------------------+
```

### Key UI Features:
1. **Interactive Crop Box**: Draggable and resizable bounding box overlay with 8 corner/edge anchor handles. Supports aspect ratio locking (Free, 1:1, 4:5, 16:9, Passport 35x45mm, US Visa 2x2in).
2. **Physical Unit Toolbar**: Live unit toggle (`px` $\leftrightarrow$ `cm` $\leftrightarrow$ `mm` $\leftrightarrow$ `in`), DPI toggle (`72`, `150`, `300`, `600`), live pixel recalculation.
3. **Background Remover Panel**: 1-click button, checkerboard background toggle, solid color hex picker.
4. **Before/After Split Slider**: Compare original upload vs edited/background-removed version side-by-side.
5. **Action Bar**: Rotate 90°, Flip H/V, Reset, Download, Save as New Artifact.

---

## 4. End-to-End Wiring: Step-by-Step

### Step 1: User Upload / Selection
- User uploads an image in the chat composer (`/api/files/upload`).
- Storage records original file in Supabase Storage (`artifacts/{userId}/{chatId}/{timestamp}-photo.jpg`).
- Creates DB record in `Artifact` table (`kind: 'image'`).

### Step 2: In-Chat Tool Invocation
- User types: *"Resize this photo to Indian passport size 35x45mm at 300 DPI and remove the background"*.
- Gemini 2.5 Flash outputs tool calls:
  1. `image_remove_bg({ artifactId: "art_123", mode: "solid_color", backgroundColor: "#ffffff" })`
  2. `image_resize_physical({ artifactId: "art_derived", widthMm: 35, heightMm: 45, dpi: 300 })`

### Step 3: Server Execution & Lineage
- Backend tool downloads source buffer via `downloadArtifact(storageKey)`.
- Executes native `removeImageBackground` and `resizeImagePhysical`.
- Uploads derived result to Supabase Storage.
- Creates new `Artifact` record with `parentArtifactId = "art_123"`.
- Appends step status to `TaskStep`.

### Step 4: UI Synchronization
- Chat receives output artifact ID and short-lived signed preview URL.
- Chat card updates: `[Download Verified Photo (413x531 px, 300 DPI)] [Open in Studio]`.
- Right Pane automatically loads `<ImageStudioCanvas />` with the processed output.
