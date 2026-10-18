import "server-only";

import fs from "node:fs";
import path from "node:path";
import { refineAlpha, toAlphaBytes, toAlphaFloats } from "./alpha";
import { getSharp } from "./native";

/**
 * Native (on-device) background removal.
 *
 * The segmentation model ships inside `@imgly/background-removal-node` as
 * content-addressed ONNX chunks, and inference runs through `onnxruntime-node` —
 * no external API is contacted and no image ever leaves the machine.
 *
 * Two deployment details matter and are handled here explicitly:
 *
 * 1. `onnxruntime-node` loads a native shared library (`libonnxruntime.so.*`,
 *    `onnxruntime.dll`, …) that no JavaScript `require` mentions, so bundlers do
 *    not trace it. It is pulled into the function through
 *    `outputFileTracingIncludes` in `next.config.ts`, and
 *    {@link resolveModelDirectory} finds the model chunks by inspecting the
 *    filesystem at runtime instead of trusting a module id (a bundled
 *    `require.resolve` does not survive into the deployed function).
 * 2. The raw model matte is predicted at 1024x1024 and is soft once scaled up. Its
 *    edge band is squeezed and re-feathered in `refineAlpha`, so cutouts read as
 *    crisp, anti-aliased edges instead of a blurry halo.
 */

const RESOURCES_FILENAME = "resources.json";
const PACKAGE_DIRECTORY = path.join("@imgly", "background-removal-node");
const MODEL_RESOLUTION = 1024;
const MODEL_CHANNELS = 3;
/** The most detailed model variant the package ships (fp32 "medium"). */
const MODEL = "medium";
/** Pixel mean/std the model was trained with. */
const MODEL_MEAN = 128;
const MODEL_STD = 256;
/** Edge-aware refinement runs at most at this long edge to bound memory. */
const REFINEMENT_MAX_EDGE = 1536;
export const DEFAULT_EDGE_SMOOTHING = 25;

interface ModelChunk {
  hash: string;
  offsets: number[];
}

interface ModelResource {
  chunks: ModelChunk[];
  size: number;
}

type OrtModule = typeof import("onnxruntime-node");
type OrtSession = import("onnxruntime-node").InferenceSession;

export interface AlphaMatte {
  /** Single-channel, 8-bit alpha at the source resolution. */
  alpha: Buffer;
  height: number;
  /**
   * The fully oriented source (EXIF rotation baked in) that `alpha` lines up with.
   * Always compose against this buffer, never against the raw upload.
   */
  source: Buffer;
  width: number;
}

export interface SegmentImageOptions {
  /** 0 = crisp edge transition, 100 = soft feathered transition. */
  edgeSmoothing?: number;
}

let modelDirectory: string | null | undefined;
let ortPromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;

function pnpmModelDirectories(nodeModules: string): string[] {
  const store = path.join(nodeModules, ".pnpm");
  try {
    return fs
      .readdirSync(store)
      .filter((entry) => entry.startsWith("@imgly+background-removal-node@"))
      .map((entry) =>
        path.join(store, entry, "node_modules", PACKAGE_DIRECTORY, "dist")
      );
  } catch {
    return [];
  }
}

function scopedModelDirectories(nodeModules: string): string[] {
  const scope = path.join(nodeModules, "@imgly");
  try {
    return fs
      .readdirSync(scope)
      .filter((entry) => entry.startsWith("background-removal-node"))
      .map((entry) => path.join(scope, entry, "dist"));
  } catch {
    return [];
  }
}

function candidateModelDirectories(): string[] {
  const override = process.env.BG_REMOVAL_MODEL_DIR;
  if (override) {
    return [path.resolve(override)];
  }

  const cwd = process.cwd();
  const candidates: string[] = [];
  // The cwd is the function root on Vercel and the project root locally; its parent
  // is included so a nested working directory still finds an installed package.
  for (const root of [cwd, path.resolve(cwd, "..")]) {
    const nodeModules = path.join(root, "node_modules");
    candidates.push(path.join(nodeModules, PACKAGE_DIRECTORY, "dist"));
    candidates.push(...pnpmModelDirectories(nodeModules));
    candidates.push(...scopedModelDirectories(nodeModules));
    candidates.push(
      ...scopedModelDirectories(path.join(root, ".next", "node_modules"))
    );
  }
  return candidates;
}

/**
 * Directory holding `resources.json` plus the ONNX model chunks, or `null` when the
 * deployment did not ship them. Memoised; callers fail loudly on `null` so a broken
 * bundle never looks like a broken photo.
 */
export function resolveModelDirectory(): string | null {
  if (modelDirectory !== undefined) {
    return modelDirectory;
  }

  const found = candidateModelDirectories().find((directory) =>
    fs.existsSync(path.join(directory, RESOURCES_FILENAME))
  );
  modelDirectory = found ?? null;
  if (modelDirectory) {
    console.info(`Background removal model directory: ${modelDirectory}`);
  } else {
    console.error(
      "Background removal model files were not found in this deployment."
    );
  }
  return modelDirectory;
}

async function loadOrt(): Promise<OrtModule> {
  try {
    return await import("onnxruntime-node");
  } catch (cause) {
    throw new Error(
      "The native background-removal engine could not be loaded. Its ONNX runtime library is missing from this deployment.",
      { cause }
    );
  }
}

async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = loadOrt();
  }
  try {
    return await ortPromise;
  } catch (error) {
    ortPromise = null;
    throw error;
  }
}

/**
 * Reassemble the model's content-addressed chunks into a single ONNX buffer. Sizes
 * are validated so a partially copied deployment fails here with a clear message
 * rather than deep inside the runtime.
 */
async function loadModelBuffer(
  directory: string,
  model: string
): Promise<Buffer> {
  const raw = await fs.promises.readFile(
    path.join(directory, RESOURCES_FILENAME),
    "utf8"
  );
  const resources = JSON.parse(raw) as Record<string, ModelResource>;
  const resource = resources[`/models/${model}`];
  if (!resource?.chunks?.length) {
    throw new Error(
      `The "${model}" background-removal model is missing from this deployment.`
    );
  }

  const chunks = await Promise.all(
    resource.chunks.map(async (chunk) => {
      const data = await fs.promises.readFile(path.join(directory, chunk.hash));
      const expected = chunk.offsets[1] - chunk.offsets[0];
      if (data.length !== expected) {
        throw new Error(
          `Background-removal model chunk ${chunk.hash} is incomplete (${data.length} of ${expected} bytes).`
        );
      }
      return data;
    })
  );

  return Buffer.concat(chunks, resource.size);
}

async function createSession(): Promise<OrtSession> {
  const directory = resolveModelDirectory();
  if (!directory) {
    throw new Error(
      "Background removal is unavailable because its model files were not bundled with this deployment."
    );
  }

  const [ort, modelBuffer] = await Promise.all([
    getOrt(),
    loadModelBuffer(directory, MODEL),
  ]);

  return ort.InferenceSession.create(modelBuffer, {
    executionMode: "sequential",
    graphOptimizationLevel: "all",
  });
}

/**
 * One ONNX session per process: warm invocations reuse the loaded model, which is
 * what keeps repeated edits fast. A failure clears the cache so a later request can
 * retry instead of being poisoned forever.
 */
async function getSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = createSession();
  }
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

interface RefinementSize {
  height: number;
  scale: number;
  width: number;
}

function refinementSize(width: number, height: number): RefinementSize {
  const scale = Math.min(1, REFINEMENT_MAX_EDGE / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * scale)),
    scale,
    width: Math.max(1, Math.round(width * scale)),
  };
}

/** BCHW, mean/std normalised float tensor for the model. */
function toModelTensor(
  rgb: Uint8Array,
  resolution: number
): { data: Float32Array; dims: number[] } {
  const plane = resolution * resolution;
  const data = new Float32Array(plane * MODEL_CHANNELS);
  for (let i = 0; i < plane; i += 1) {
    const source = i * MODEL_CHANNELS;
    data[i] = (rgb[source] - MODEL_MEAN) / MODEL_STD;
    data[plane + i] = (rgb[source + 1] - MODEL_MEAN) / MODEL_STD;
    data[plane * 2 + i] = (rgb[source + 2] - MODEL_MEAN) / MODEL_STD;
  }
  return { data, dims: [1, MODEL_CHANNELS, resolution, resolution] };
}

/**
 * Predict the alpha matte for an image and refine it against the image's own edges.
 *
 * @param inputBuffer - Source image bytes (JPEG, PNG, WebP, …).
 * @returns Alpha at the source resolution plus the oriented source to compose it
 *   against.
 */
export async function segmentImage(
  inputBuffer: Buffer,
  options: SegmentImageOptions = {}
): Promise<AlphaMatte> {
  const sharp = await getSharp();
  const [ort, session, metadata] = await Promise.all([
    getOrt(),
    getSession(),
    sharp(inputBuffer).metadata(),
  ]);

  // Bake EXIF rotation into the pixels so the matte, any crop and the output all
  // agree with what the user sees in the browser.
  const rotated = Boolean(metadata.orientation && metadata.orientation !== 1);
  const source = rotated
    ? await sharp(inputBuffer).rotate().toBuffer()
    : inputBuffer;
  const oriented = rotated ? await sharp(source).metadata() : metadata;
  const width = oriented.width ?? 0;
  const height = oriented.height ?? 0;
  if (width < 1 || height < 1) {
    throw new Error(
      "Could not read the image dimensions for background removal."
    );
  }

  // Model input: fixed square, colour only, sharp's high-quality resampling.
  // `toColourspace` is not decoration: sharp's raw output defaults to sRGB, so a
  // buffer left alone would come back with three interleaved channels (and a CMYK
  // upload would keep four), which would silently shear the whole tensor.
  const { data: rgb, info } = await sharp(source)
    .resize(MODEL_RESOLUTION, MODEL_RESOLUTION, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== MODEL_CHANNELS) {
    throw new Error(
      `Expected ${MODEL_CHANNELS} colour channels for background removal, got ${info.channels}.`
    );
  }

  const tensorInput = toModelTensor(rgb, info.width);
  const tensor = new ort.Tensor("float32", tensorInput.data, tensorInput.dims);
  const [inputName] = session.inputNames;
  if (!inputName) {
    throw new Error("The background-removal model exposes no input.");
  }
  const outputs = await session.run({ [inputName]: tensor });
  const [outputName] = session.outputNames;
  const prediction = outputs[outputName];
  if (!prediction) {
    throw new Error("The background-removal model returned no output.");
  }
  const modelAlpha = toAlphaBytes(prediction.data);

  // Refine at (at most) REFINEMENT_MAX_EDGE: far above the model's own 1024px
  // resolution, but bounded so a huge upload cannot exhaust the function's memory.
  // `toColourspace("b-w")` keeps the matte single-channel; without it the raw
  // buffer comes back as three interleaved planes and every later step reads a
  // third of the matte as if it were the whole thing.
  const refine = refinementSize(width, height);
  const scaledAlpha = await sharp(Buffer.from(modelAlpha), {
    raw: { channels: 1, height: MODEL_RESOLUTION, width: MODEL_RESOLUTION },
  })
    .resize(refine.width, refine.height, { fit: "fill", kernel: "lanczos3" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const refined = refineAlpha({
    alpha: toAlphaFloats(scaledAlpha),
    edgeSmoothing: options.edgeSmoothing ?? DEFAULT_EDGE_SMOOTHING,
    height: refine.height,
    width: refine.width,
  });

  const refinedBytes = toAlphaBytes(refined);
  const alpha =
    refine.scale >= 1
      ? Buffer.from(refinedBytes)
      : await sharp(Buffer.from(refinedBytes), {
          raw: { channels: 1, height: refine.height, width: refine.width },
        })
          .resize(width, height, { fit: "fill", kernel: "lanczos3" })
          .toColourspace("b-w")
          .raw()
          .toBuffer();

  return { alpha, height, source, width };
}
