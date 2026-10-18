/**
 * Minimal ambient types for `onnxruntime-node`.
 *
 * The published package (1.17.0) points `"types"` at `dist/index.d.ts`, but that
 * file is not actually part of the tarball, so TypeScript would otherwise fall back
 * to `any` for the whole module. Only the surface used by
 * `lib/image/background-removal.ts` is described here.
 */
declare module "onnxruntime-node" {
  export interface SessionOptions {
    executionMode?: "sequential" | "parallel";
    graphOptimizationLevel?: "all" | "basic" | "extended" | "disabled";
  }

  export interface Tensor {
    readonly data: Float32Array;
    readonly dims: readonly number[];
  }

  export interface TensorConstructor {
    new (type: "float32", data: Float32Array, dims: readonly number[]): Tensor;
  }

  export interface InferenceSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run: (feeds: Record<string, Tensor>) => Promise<Record<string, Tensor>>;
  }

  export interface InferenceSessionConstructor {
    create: (
      model: Uint8Array,
      options?: SessionOptions
    ) => Promise<InferenceSession>;
  }

  export const Tensor: TensorConstructor;
  export const InferenceSession: InferenceSessionConstructor;
}
