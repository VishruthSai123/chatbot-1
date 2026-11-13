const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_DIMENSION = 2048;
const QUALITY = 0.85;
const MIN_BYTES_TO_TRY = 300_000;

/**
 * Shrinks a photo in the browser before it ever reaches storage.
 *
 * This is deliberately conservative: it only handles formats the browser can
 * decode, keeps the original when the result is not smaller, and leaves PNG
 * transparency alone. The savings are storage, egress and server decode time.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!(COMPRESSIBLE_TYPES.has(file.type) && file.size >= MIN_BYTES_TO_TRY)) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_DIMENSION / longestSide);

    if (scale >= 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputType, QUALITY);
    });

    if (!(blob && blob.size < file.size)) {
      return file;
    }

    const extension = outputType === "image/jpeg" ? ".jpg" : ".png";
    const name = file.name.replace(/\.[^.]+$/, extension);

    return new File([blob], name, {
      lastModified: Date.now(),
      type: outputType,
    });
  } catch {
    // HEIC, corrupt files and browsers without createImageBitmap keep the
    // original path. The server still validates the upload.
    return file;
  }
}
