import "server-only";

import { PDFDocument, type PDFImage } from "pdf-lib";
import { getSharp } from "@/lib/image/native";

export type ImageToPdfLayout = "fit" | "a4" | "letter";

export interface ImageToPdfInput {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
}

export interface ImageToPdfOptions {
  layout?: ImageToPdfLayout;
  margin?: number;
  title?: string;
}

export interface ImageToPdfResult {
  buffer: Buffer;
  pages: number;
  sizeBytes: number;
  title?: string;
}

// Standard page dimensions in points (72 points = 1 inch)
const PAGE_SIZES: Record<"a4" | "letter", { width: number; height: number }> = {
  a4: { height: 841.89, width: 595.28 },
  letter: { height: 792, width: 612 },
};

/**
 * Converts one or more images into a single PDF document.
 *
 * Each image is normalized via Sharp (handling EXIF orientation, WebP/AVIF/HEIC
 * transcode to JPEG/PNG), embedded into `pdf-lib`, and drawn with clean layout
 * options (fit to image aspect, standard A4, or US Letter).
 */
export async function convertImagesToPdf(
  images: ImageToPdfInput[],
  options: ImageToPdfOptions = {}
): Promise<ImageToPdfResult> {
  if (!images || images.length === 0) {
    throw new Error("No images provided for PDF conversion.");
  }

  const layout = options.layout ?? "fit";
  const margin = Math.max(0, options.margin ?? (layout === "fit" ? 0 : 28));
  const pdfDoc = await PDFDocument.create();

  if (options.title) {
    pdfDoc.setTitle(options.title);
  }
  pdfDoc.setProducer("SuperiorAI PDF Studio");

  const sharp = await getSharp();

  const prepared = await Promise.all(
    images.map(async (input) => {
      // 1. Normalize image with Sharp: auto-orient based on EXIF and extract metadata
      const pipeline = sharp(input.buffer).rotate();
      const metadata = await pipeline.metadata();

      const rawWidth = metadata.width || 800;
      const rawHeight = metadata.height || 600;
      const hasAlpha = metadata.hasAlpha ?? false;

      // 2. Transcode to PNG (if transparent or PNG) or high-quality JPEG for embedding
      if (hasAlpha || metadata.format === "png") {
        const pngBuffer = await pipeline.png().toBuffer();
        return { buffer: pngBuffer, isPng: true, rawHeight, rawWidth };
      }

      const jpgBuffer = await pipeline.jpeg({ quality: 92 }).toBuffer();
      return { buffer: jpgBuffer, isPng: false, rawHeight, rawWidth };
    })
  );

  const embeddedImages: Array<{
    embeddedImage: PDFImage;
    rawHeight: number;
    rawWidth: number;
  }> = await Promise.all(
    prepared.map(async (item) => ({
      embeddedImage: item.isPng
        ? await pdfDoc.embedPng(item.buffer)
        : await pdfDoc.embedJpg(item.buffer),
      rawHeight: item.rawHeight,
      rawWidth: item.rawWidth,
    }))
  );

  for (const item of embeddedImages) {
    const imgWidth = item.embeddedImage.width || item.rawWidth;
    const imgHeight = item.embeddedImage.height || item.rawHeight;
    const isLandscape = imgWidth > imgHeight;

    // 3. Determine page dimensions based on requested layout
    let pageWidth: number;
    let pageHeight: number;
    let drawX = 0;
    let drawY = 0;
    let drawWidth = imgWidth;
    let drawHeight = imgHeight;

    if (layout === "fit") {
      // In fit mode, scale large images proportionally so page bounds remain standard (max 842 pt)
      const maxEdge = 842;
      let scale = 1;
      if (imgWidth > maxEdge || imgHeight > maxEdge) {
        scale = Math.min(maxEdge / imgWidth, maxEdge / imgHeight);
      }
      pageWidth = Math.round(imgWidth * scale);
      pageHeight = Math.round(imgHeight * scale);
      drawWidth = pageWidth;
      drawHeight = pageHeight;
      drawX = 0;
      drawY = 0;
    } else {
      // Standard page size (A4 or Letter) with orientation matching image
      const standard = PAGE_SIZES[layout];
      pageWidth = isLandscape ? standard.height : standard.width;
      pageHeight = isLandscape ? standard.width : standard.height;

      const usableWidth = Math.max(1, pageWidth - margin * 2);
      const usableHeight = Math.max(1, pageHeight - margin * 2);

      const scale = Math.min(usableWidth / imgWidth, usableHeight / imgHeight);
      drawWidth = Math.round(imgWidth * scale);
      drawHeight = Math.round(imgHeight * scale);

      drawX = margin + Math.round((usableWidth - drawWidth) / 2);
      drawY = margin + Math.round((usableHeight - drawHeight) / 2);
    }

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(item.embeddedImage, {
      height: drawHeight,
      width: drawWidth,
      x: drawX,
      y: drawY,
    });
  }

  const pdfBytes = Buffer.from(
    await pdfDoc.save({ addDefaultPage: false, useObjectStreams: true })
  );

  return {
    buffer: pdfBytes,
    pages: pdfDoc.getPageCount(),
    sizeBytes: pdfBytes.length,
    title: options.title,
  };
}
