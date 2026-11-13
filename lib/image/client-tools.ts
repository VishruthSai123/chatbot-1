"use client";

import { imageSrcToDataUrl } from "@/lib/image/mime";
import { IMAGE_TOOL_ENDPOINT } from "@/lib/tools/endpoint";

export type ClientImageAction =
  | "compress"
  | "convert"
  | "crop"
  | "resize"
  | "rotate";

export function clientImageToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLIENT_IMAGE_TOOLS === "true";
}

type ClientImageInput = {
  action: ClientImageAction;
  documentId?: string;
  flattenAlpha?: boolean;
  imageSrc: string;
  params: Record<string, unknown>;
  versionIndex?: number;
};

type ClientImageResult = {
  documentId?: string;
  persisted: boolean;
  result: {
    base64: string;
    format: string;
    height: number;
    sizeBytes: number;
    storageKey?: string;
    thumbUrl?: string;
    url?: string;
    width: number;
  };
  success: true;
  transparencyPreserved?: boolean;
};

/**
 * Runs the cheap image operations in the browser.
 *
 * Returns null when the operation is not safe to do locally (unknown units,
 * low-memory decode failure, unsupported format, CORS failure). The caller then
 * uses the existing server action, so this is an optimisation, never a
 * regression.
 */
export async function runClientImageAction(
  input: ClientImageInput
): Promise<ClientImageResult | null> {
  if (!clientImageToolsEnabled()) {
    return null;
  }

  try {
    const bitmap = await loadBitmap(input.imageSrc);
    const sheet = render(bitmap, input);
    bitmap.close();

    if (!sheet) {
      return null;
    }

    const blob =
      Number(input.params.targetSizeKb) > 0
        ? await encodeToTarget(
            sheet.canvas,
            sheet.format,
            sheet.quality,
            Number(input.params.targetSizeKb) * 1024
          )
        : await encode(sheet.canvas, sheet.format, sheet.quality);
    if (!blob) {
      return null;
    }

    const dataUrl = await blobToDataUrl(blob);
    const response = await fetch(IMAGE_TOOL_ENDPOINT, {
      body: JSON.stringify({
        action: "persist",
        documentId: input.documentId,
        image: dataUrl,
        params: {
          format: sheet.format,
          height: sheet.canvas.height,
          width: sheet.canvas.width,
        },
        versionIndex: input.versionIndex,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ClientImageResult;
    return data.result?.base64 ? data : null;
  } catch (error) {
    // The server path is the fallback, so a failure here is not user-visible.
    // Keep a debug breadcrumb rather than hiding why the fast path was skipped.
    console.debug("Client image action fell back to the server:", error);
    return null;
  }
}

async function loadBitmap(src: string): Promise<ImageBitmap> {
  // The studio holds two source shapes: a signed storage URL after a reload, and
  // bare base64 after a local edit. Only the former is fetchable; a bare base64
  // string would resolve as a relative path and fail with HTTP 414.
  const url = imageSrcToDataUrl(src);
  const blob = url.startsWith("data:")
    ? dataUrlToBlob(url)
    : await fetchImageBlob(url);
  return await createImageBitmap(blob, { imageOrientation: "from-image" });
}

async function fetchImageBlob(url: string): Promise<Blob> {
  // `cache: "reload"` is required, not an optimisation. The studio already shows
  // the image through an `<img>` tag, which stores a no-CORS response in the
  // HTTP cache. Reusing that entry for `fetch()` fails the CORS check because
  // the cached response has no `Access-Control-Allow-Origin`, even though the
  // origin would get one on a fresh request. Forcing revalidation avoids the
  // poisoned cache entry.
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) {
    throw new Error(`image fetch ${response.status}`);
  }
  return await response.blob();
}

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  const header = url.slice(5, comma);
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], {
    type: header.split(";")[0] || "application/octet-stream",
  });
}

type Rendered = {
  canvas: HTMLCanvasElement;
  format: string;
  quality: number;
};

function render(bitmap: ImageBitmap, input: ClientImageInput): Rendered | null {
  const { action, params } = input;

  if (action === "resize") {
    const unit = typeof params.unit === "string" ? params.unit : "px";
    if (unit !== "px") {
      return null;
    }
  }

  const source = { height: bitmap.height, width: bitmap.width };

  if (action === "rotate") {
    const angle = ((Number(params.angle) % 360) + 360) % 360;
    const radians = (angle * Math.PI) / 180;
    const quarterTurn = angle === 90 || angle === 270;
    const canvas = document.createElement("canvas");
    canvas.width = quarterTurn ? bitmap.height : bitmap.width;
    canvas.height = quarterTurn ? bitmap.width : bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    if (input.flattenAlpha) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(radians);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return {
      canvas,
      format: outputFormat(input),
      quality: 0.9,
    };
  }

  const target = targetRect(action, params, source);
  if (!target) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(target.width));
  canvas.height = Math.max(1, Math.round(target.height));
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  if (input.flattenAlpha) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(
    bitmap,
    target.sx,
    target.sy,
    target.sw,
    target.sh,
    target.dx,
    target.dy,
    target.dw,
    target.dh
  );

  const format = outputFormat(input);
  const quality =
    action === "compress" && typeof params.quality === "number"
      ? Math.min(1, Math.max(0.1, params.quality / 100))
      : 0.9;

  return { canvas, format, quality };
}

function targetRect(
  action: ClientImageAction,
  params: Record<string, unknown>,
  source: { height: number; width: number }
) {
  if (action === "crop") {
    const left = Number(params.left);
    const top = Number(params.top);
    const width = Number(params.width);
    const height = Number(params.height);
    if (![left, top, width, height].every(Number.isFinite)) {
      return null;
    }
    return {
      dh: height,
      dw: width,
      dx: 0,
      dy: 0,
      height,
      sh: height,
      sw: width,
      sx: left,
      sy: top,
      width,
    };
  }

  if (action === "resize") {
    const width = Number(params.width);
    const height = Number(params.height);
    const fit = typeof params.fit === "string" ? params.fit : "cover";
    if (!(width > 0 && height > 0)) {
      return null;
    }

    if (fit === "contain") {
      const scale = Math.min(width / source.width, height / source.height);
      const drawWidth = source.width * scale;
      const drawHeight = source.height * scale;
      return {
        dh: drawHeight,
        dw: drawWidth,
        dx: (width - drawWidth) / 2,
        dy: (height - drawHeight) / 2,
        height,
        sh: source.height,
        sw: source.width,
        sx: 0,
        sy: 0,
        width,
      };
    }

    if (fit === "cover") {
      const scale = Math.max(width / source.width, height / source.height);
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      return {
        dh: height,
        dw: width,
        dx: 0,
        dy: 0,
        height,
        sh: sourceHeight,
        sw: sourceWidth,
        sx: (source.width - sourceWidth) / 2,
        sy: (source.height - sourceHeight) / 2,
        width,
      };
    }

    return {
      dh: height,
      dw: width,
      dx: 0,
      dy: 0,
      height,
      sh: source.height,
      sw: source.width,
      sx: 0,
      sy: 0,
      width,
    };
  }

  return {
    dh: source.height,
    dw: source.width,
    dx: 0,
    dy: 0,
    height: source.height,
    sh: source.height,
    sw: source.width,
    sx: 0,
    sy: 0,
    width: source.width,
  };
}

function outputFormat(input: ClientImageInput): string {
  const requested =
    typeof input.params.format === "string"
      ? input.params.format
      : typeof input.params.targetFormat === "string"
        ? input.params.targetFormat
        : "png";
  const normalized = requested.toLowerCase().replace("jpg", "jpeg");

  if (normalized === "jpeg" || normalized === "webp") {
    return normalized;
  }
  return "png";
}

async function encode(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number
): Promise<Blob | null> {
  const type =
    format === "jpeg"
      ? "image/jpeg"
      : format === "webp"
        ? "image/webp"
        : "image/png";

  return await new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function encodeToTarget(
  canvas: HTMLCanvasElement,
  format: string,
  startingQuality: number,
  targetBytes: number
): Promise<Blob | null> {
  let smallest: Blob | null = null;
  let quality = Math.min(0.95, Math.max(0.2, startingQuality));

  while (quality >= 0.2) {
    // biome-ignore lint/performance/noAwaitInLoops: target-size encoding is sequential by design.
    const blob = await encode(canvas, format, quality);
    if (!blob) {
      return null;
    }
    if (!smallest || blob.size < smallest.size) {
      smallest = blob;
    }
    if (blob.size <= targetBytes) {
      return blob;
    }
    quality = Math.round((quality - 0.1) * 100) / 100;
  }

  return smallest;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
