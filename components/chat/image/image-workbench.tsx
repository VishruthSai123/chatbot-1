import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  LayoutGrid,
  Lock,
  Maximize2,
  Redo2,
  SlidersHorizontal,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageToolMode } from "@/components/chat/artifact";
import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { aspectRatioInPercent, type CropBox } from "@/lib/image/crop-box";
import { imageDownloadName, imageSrcToDataUrl } from "@/lib/image/mime";
import { CROP_ASPECT_PRESETS } from "@/lib/image/presets";
import {
  decodeImageCollection,
  encodeImageCollection,
  type ImageCollectionItem,
  type ImageCollectionRef,
} from "@/lib/image/ref";
import { toolEndpoint } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";
import { BeforeAfterSlider } from "../before-after-slider";
import { BackgroundRemovalInspector } from "./background-removal-inspector";
import { CompressionInspector } from "./compression-inspector";
import { ConverterInspector } from "./converter-inspector";
import { CropInspector } from "./crop-inspector";
import { CropOverlay, CropShade } from "./crop-overlay";
import { ImageGalleryGrid } from "./image-gallery-grid";
import { OcrInspector } from "./ocr-inspector";
import { PixelatorInspector } from "./pixelator-inspector";
import { ResizerInspector } from "./resizer-inspector";
import { RotatorInspector } from "./rotator-inspector";
import { UpscalerInspector } from "./upscaler-inspector";

interface ImageWorkbenchProps {
  content: string; // base64 string, image-ref:, or image-collection:
  currentVersionIndex?: number;
  documentId?: string;
  handleVersionChange?: (type: "next" | "prev" | "toggle" | "latest") => void;
  isInline?: boolean;
  onSaveContent?: (
    newContent: string,
    debounce: boolean,
    options?: { persisted?: boolean }
  ) => void;
  title: string;
  totalVersions?: number;
}

const TOOL_MODES: {
  key: ImageToolMode;
  label: string;
  icon: string;
}[] = [
  { icon: "🗜️", key: "compress", label: "Compress" },
  { icon: "📐", key: "resize", label: "Resize" },
  { icon: "✂️", key: "crop", label: "Crop" },
  { icon: "✨", key: "remove_bg", label: "Remove BG" },
  { icon: "🔁", key: "convert", label: "Convert" },
  { icon: "🔬", key: "upscale", label: "Upscale" },
  { icon: "🟦", key: "pixelate", label: "Pixelate" },
  { icon: "🔄", key: "rotate", label: "Rotate" },
  { icon: "🔎", key: "ocr", label: "OCR" },
];

export const ImageWorkbench = memo(function InnerImageWorkbench({
  title,
  content,
  documentId,
  isInline: _isInline = false,
  onSaveContent,
  currentVersionIndex = 0,
  handleVersionChange,
  totalVersions = 1,
}: ImageWorkbenchProps) {
  const { artifact, setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // Active Tool Mode (defaults to artifact.toolMode or 'compress')
  const [activeToolMode, setActiveToolMode] = useState<ImageToolMode>(
    artifact.toolMode || "compress"
  );
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);

  // Sync when artifact.toolMode changes externally from tool calls
  useEffect(() => {
    if (artifact.toolMode && artifact.toolMode !== activeToolMode) {
      setActiveToolMode(artifact.toolMode);
      setIsInspectorOpen(true);
    }
  }, [artifact.toolMode, activeToolMode]);

  const handleToolModeChange = useCallback(
    (mode: ImageToolMode) => {
      setActiveToolMode(mode);
      setArtifact((prev) => ({
        ...prev,
        toolMode: mode,
      }));
    },
    [setArtifact]
  );

  // ─── Drag-to-Minimize / Gesture State ─────────────────────────────────────────
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartYRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragStartYRef.current = e.clientY;
    setIsDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (dragStartYRef.current === null) {
      return;
    }
    e.preventDefault();
    const deltaY = e.clientY - dragStartYRef.current;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    }
  }, []);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (dragStartYRef.current === null) {
      return;
    }
    e.preventDefault();
    const deltaY = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    setIsDragging(false);

    if (deltaY > 30) {
      setIsInspectorOpen(false);
    }
    setDragOffsetY(0);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    dragStartYRef.current = null;
    setIsDragging(false);
    setDragOffsetY(0);
  }, []);

  // ─── Collection & Gallery State ──────────────────────────────────────────
  const collectionRef = useMemo(
    () => decodeImageCollection(content),
    [content]
  );
  const isCollection = Boolean(
    collectionRef && collectionRef.items?.length > 0
  );

  const [viewMode, setViewMode] = useState<"gallery" | "focus">(() => {
    const parsed = decodeImageCollection(content);
    return parsed && parsed.items?.length > 1 ? "gallery" : "focus";
  });

  const [activeImageIndex, setActiveImageIndex] = useState<number>(() => {
    const parsed = decodeImageCollection(content);
    if (parsed?.activeId) {
      const idx = parsed.items.findIndex(
        (it) => it.documentId === parsed.activeId
      );
      if (idx >= 0) {
        return idx;
      }
    }
    return 0;
  });

  const activeItem = useMemo(() => {
    if (isCollection && collectionRef && collectionRef.items.length > 0) {
      return collectionRef.items[activeImageIndex] || collectionRef.items[0];
    }
    return null;
  }, [isCollection, collectionRef, activeImageIndex]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!collectionRef) {
      return;
    }
    setSelectedIds(new Set(collectionRef.items.map((it) => it.documentId)));
  }, [collectionRef]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleFocusImage = useCallback(
    (item: ImageCollectionItem, index: number) => {
      setActiveImageIndex(index);
      setViewMode("focus");
      if (item.url) {
        setCurrentBase64(item.url);
        setOriginalBase64(item.url);
      }
    },
    []
  );

  // ─── Image State ─────────────────────────────────────────────────────────────
  const [currentBase64, setCurrentBase64] = useState<string>(content);
  const [originalBase64, setOriginalBase64] = useState<string | null>(null);
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);

  // Sync with incoming content changes and resolve storage references if needed
  useEffect(() => {
    if (!content) {
      return;
    }

    if (isCollection && activeItem) {
      if (activeItem.url) {
        setCurrentBase64(activeItem.url);
        if (!originalBase64) {
          setOriginalBase64(activeItem.url);
        }
        return;
      }

      if (activeItem.documentId && activeItem.documentId !== "init") {
        fetch(toolEndpoint("image"), {
          body: JSON.stringify({
            action: "resolve",
            documentId: activeItem.documentId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
          .then((res) => res.json())
          .then((data) => {
            if (data?.result?.url) {
              setCurrentBase64(data.result.url);
              if (!originalBase64) {
                setOriginalBase64(data.result.url);
              }
            }
          })
          .catch((err) =>
            console.warn("Failed to resolve collection image:", err)
          );
      }
      return;
    }

    if (content.startsWith("image-ref:")) {
      try {
        const parsed = JSON.parse(content.slice("image-ref:".length));
        if (parsed?.url) {
          setCurrentBase64(parsed.url);
          if (!originalBase64) {
            setOriginalBase64(parsed.url);
          }
          return;
        }
      } catch {
        // ignore JSON parse error
      }

      const docId = documentId || artifact.documentId;
      if (docId && docId !== "init") {
        fetch(toolEndpoint("image"), {
          body: JSON.stringify({
            action: "resolve",
            documentId: docId,
            versionIndex: currentVersionIndex,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
          .then((res) => res.json())
          .then((data) => {
            if (data?.result?.url) {
              setCurrentBase64(data.result.url);
              if (!originalBase64) {
                setOriginalBase64(data.result.url);
              }
            }
          })
          .catch((err) => console.warn("Failed to resolve image:", err));
      }
      return;
    }

    if (content !== currentBase64) {
      setCurrentBase64(content);
    }
    if (!originalBase64) {
      setOriginalBase64(content);
    }
  }, [
    content,
    isCollection,
    activeItem,
    currentBase64,
    originalBase64,
    documentId,
    artifact.documentId,
    currentVersionIndex,
  ]);

  /**
   * Stored images are bare base64 with no declared type, so the data URL is built
   * from the bytes. Assuming PNG here would show a JPEG cutout, a WebP compression
   * result and an AVIF conversion all as the wrong type.
   */
  const formatSrc = useCallback(
    (str: string | null) => imageSrcToDataUrl(str ?? ""),
    []
  );

  // Measure natural dimensions
  useEffect(() => {
    if (!currentBase64) {
      return;
    }
    const img = new Image();
    img.src = formatSrc(currentBase64);
    img.onload = () => {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
    };
  }, [currentBase64, formatSrc]);

  // ─── Viewport Zoom & Pan State ───────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isComparing, setIsComparing] = useState<boolean>(false);

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 0.25, 3)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 0.25, 0.5)),
    []
  );
  const handleResetZoom = useCallback(() => setZoom(1), []);

  // ─── Touch Pinch-to-Zoom & Double-Tap ────────────────────────────────────────
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const lastTapRef = useRef<number>(0);

  const isCropping = activeToolMode === "crop";

  /**
   * While the crop frame is up, the canvas gestures stand down.
   *
   * A double tap would otherwise zoom to 200% on the second tap of an ordinary
   * two-tap adjustment, and a pinch mid-drag changes the zoom the crop maths was
   * measured against, which makes the frame jump under the finger. Cropping is a
   * precision gesture; the zoom pill and Fit button still work.
   */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isCropping) {
        return;
      }

      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartDistRef.current = dist;
        touchStartZoomRef.current = zoom;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          // Double tap toggle between 1x and 2x
          setZoom((z) => (z > 1.2 ? 1 : 2));
        }
        lastTapRef.current = now;
      }
    },
    [isCropping, zoom]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isCropping) {
        return;
      }

      if (e.touches.length === 2 && touchStartDistRef.current !== null) {
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = currentDist / touchStartDistRef.current;
        const nextZoom = Math.max(
          0.5,
          Math.min(3, touchStartZoomRef.current * ratio)
        );
        setZoom(Number(nextZoom.toFixed(2)));
      }
    },
    [isCropping]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartDistRef.current = null;
  }, []);

  // ─── Crop Box State ──────────────────────────────────────────────────────────
  const [cropBox, setCropBox] = useState<CropBox>({
    height: 80,
    width: 80,
    x: 10,
    y: 10,
  });
  const [selectedAspect, setSelectedAspect] = useState<string>("free");
  const imageContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Locked aspect translated into percentage space, so dragging a handle keeps
   * the requested pixel ratio on non-square images.
   */
  const cropAspectK = useMemo(() => {
    const preset = CROP_ASPECT_PRESETS.find((p) => p.key === selectedAspect);
    return aspectRatioInPercent({
      naturalHeight,
      naturalWidth,
      ratio: preset?.ratio ?? null,
    });
  }, [selectedAspect, naturalHeight, naturalWidth]);

  const canUndo = (currentVersionIndex ?? 0) > 0;
  const canRedo = (currentVersionIndex ?? 0) < (totalVersions ?? 1) - 1;

  const handleCopy = useCallback(() => {
    if (!currentBase64) {
      return;
    }
    try {
      const src = formatSrc(currentBase64);
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            toast.success("Image copied to clipboard!");
          }
        }, "image/png");
      };
    } catch {
      toast.error("Failed to copy image to clipboard");
    }
  }, [currentBase64, formatSrc]);

  const handleDownload = useCallback(() => {
    if (!currentBase64) {
      return;
    }
    const link = document.createElement("a");
    link.href = formatSrc(currentBase64);
    link.download = imageDownloadName("superiorai-image", currentBase64);
    link.click();
    toast.success("Download started!");
  }, [currentBase64, formatSrc]);

  const handleDownloadItem = useCallback((item: ImageCollectionItem) => {
    const src = item.url || item.thumbUrl;
    if (!src) {
      return;
    }
    const link = document.createElement("a");
    link.href = src;
    link.download =
      item.filename ||
      `${item.title || "image"}.${item.format ? item.format.replace("image/", "") : "png"}`;
    link.click();
    toast.success("Download started!");
  }, []);

  const handleCopyItem = useCallback(async (item: ImageCollectionItem) => {
    const src = item.url || item.thumbUrl;
    if (!src) {
      return;
    }
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob }),
            ]);
            toast.success("Image copied to clipboard!");
          }
        }, "image/png");
      };
    } catch {
      toast.error("Failed to copy image to clipboard");
    }
  }, []);

  const handleBatchToPdf = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      if (isGuest) {
        setShowAuthModal(true);
        return;
      }
      setIsProcessing(true);
      const toastId = toast.loading("Converting selected images to PDF...");
      try {
        const res = await fetch(toolEndpoint("pdf"), {
          body: JSON.stringify({
            action: "images-to-pdf",
            chatId: artifact.documentId,
            content,
            sourceDocumentIds: ids,
            title: "Images Document",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to create PDF");
        }
        toast.success(
          `PDF created successfully (${data.result?.pages ?? ids.length} pages)`,
          { id: toastId }
        );
        const pdfEnvelope = `pdf-ref:${JSON.stringify({
          bytes: data.result?.sizeBytes,
          filename: data.result?.filename || "Images Document.pdf",
          pages: data.result?.pages,
          storageKey: data.result?.storageKey,
        })}`;
        setArtifact({
          boundingBox: { height: 0, left: 0, top: 0, width: 0 },
          content: pdfEnvelope,
          documentId: data.documentId || "new",
          isVisible: true,
          kind: "pdf",
          status: "idle",
          title: "Images Document",
        });
      } catch (err: any) {
        toast.error(err.message || "Failed to convert images to PDF", {
          id: toastId,
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [artifact.documentId, content, isGuest, setArtifact]
  );

  const handleBatchConvertWebP = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      if (isGuest) {
        setShowAuthModal(true);
        return;
      }
      setIsProcessing(true);
      const toastId = toast.loading(
        `Converting ${ids.length} images to WebP...`
      );
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const res = await fetch(toolEndpoint("image"), {
              body: JSON.stringify({
                action: "convert",
                documentId: id,
                params: { format: "webp" },
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            });
            return res.ok;
          })
        );
        const count = results.filter(Boolean).length;
        toast.success(`Converted ${count} images to WebP!`, { id: toastId });
        setSelectedIds(new Set());
      } catch (err: any) {
        toast.error(err.message || "Failed to convert images", { id: toastId });
      } finally {
        setIsProcessing(false);
      }
    },
    [isGuest]
  );

  const handleBatchCompress = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      if (isGuest) {
        setShowAuthModal(true);
        return;
      }
      setIsProcessing(true);
      const toastId = toast.loading(`Compressing ${ids.length} images...`);
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const res = await fetch(toolEndpoint("image"), {
              body: JSON.stringify({
                action: "compress",
                documentId: id,
                params: { quality: 80 },
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            });
            return res.ok;
          })
        );
        const count = results.filter(Boolean).length;
        toast.success(`Compressed ${count} images!`, { id: toastId });
        setSelectedIds(new Set());
      } catch (err: any) {
        toast.error(err.message || "Failed to compress images", {
          id: toastId,
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [isGuest]
  );

  // Image update handler from inspectors. `persisted` means the tool route already
  // stored this version server-side, so the save must not send the bytes back up.
  const handleUpdateImage = useCallback(
    (newBase64: string, persisted = false) => {
      setCurrentBase64(newBase64);

      if (isCollection && collectionRef) {
        const updatedItems = collectionRef.items.map((it, idx) =>
          idx === activeImageIndex
            ? {
                ...it,
                thumbUrl: newBase64,
                url: newBase64,
              }
            : it
        );
        const nextCollection: ImageCollectionRef = {
          ...collectionRef,
          activeId: activeItem?.documentId,
          items: updatedItems,
        };
        const nextContent = encodeImageCollection(nextCollection);

        if (onSaveContent) {
          onSaveContent(nextContent, false, { persisted });
        }
        setArtifact((prev) => ({
          ...prev,
          content: nextContent,
        }));
        return;
      }

      if (onSaveContent) {
        onSaveContent(newBase64, false, { persisted });
      }
      setArtifact((prev) => ({
        ...prev,
        content: newBase64,
      }));
    },
    [
      activeImageIndex,
      activeItem?.documentId,
      collectionRef,
      isCollection,
      onSaveContent,
      setArtifact,
    ]
  );

  const currentDocId =
    activeItem?.documentId || documentId || artifact.documentId;
  const activeToolObj = TOOL_MODES.find((m) => m.key === activeToolMode);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* ─── Unified Studio Header: identity + actions (tools live in row 2) ─── */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 backdrop-blur-sm">
        {/* Left: Close Button + Title / Breadcrumbs + Stepper */}
        <div className="flex min-w-0 items-center gap-2">
          <ArtifactCloseButton />

          {isCollection && (collectionRef?.items.length ?? 0) > 1 ? (
            viewMode === "focus" ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
                  onClick={() => setViewMode("gallery")}
                  title="Back to Gallery"
                  type="button"
                >
                  <ArrowLeft className="size-3.5" />
                  <span className="hidden sm:inline">Gallery</span>
                  <span className="rounded bg-muted px-1 font-mono text-[10px]">
                    {collectionRef?.items.length}
                  </span>
                </button>
                <span className="text-muted-foreground/60 select-none">/</span>
                <span className="font-semibold text-xs md:text-sm text-foreground tracking-tight truncate max-w-[110px] sm:max-w-[160px] md:max-w-xs">
                  {activeItem?.filename ||
                    activeItem?.title ||
                    `Image ${activeImageIndex + 1}`}
                </span>

                {/* Stepper between images in collection */}
                <div className="flex items-center gap-0.5 border-l border-border/40 pl-1.5 shrink-0">
                  <button
                    aria-label="Previous image"
                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    disabled={activeImageIndex <= 0}
                    onClick={() =>
                      setActiveImageIndex((i) => Math.max(0, i - 1))
                    }
                    title="Previous image"
                    type="button"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {activeImageIndex + 1}/{collectionRef?.items.length}
                  </span>
                  <button
                    aria-label="Next image"
                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    disabled={
                      activeImageIndex >= (collectionRef?.items.length ?? 1) - 1
                    }
                    onClick={() =>
                      setActiveImageIndex((i) =>
                        Math.min((collectionRef?.items.length ?? 1) - 1, i + 1)
                      )
                    }
                    title="Next image"
                    type="button"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs md:text-sm text-foreground tracking-tight truncate max-w-[140px] sm:max-w-[220px]">
                    {artifact.title || title || "Image Collection"}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground shrink-0">
                    {collectionRef?.items.length} images
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs md:text-sm text-foreground tracking-tight truncate max-w-[130px] sm:max-w-[200px] md:max-w-xs">
                  {artifact.title || title || "image.png"}
                </span>
                {(totalVersions ?? 1) > 1 && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground shrink-0">
                    v{(currentVersionIndex ?? 0) + 1}/{totalVersions}
                  </span>
                )}
              </div>
              {naturalWidth > 0 && naturalHeight > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground truncate leading-none">
                  {naturalWidth} × {naturalHeight} px
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: View Mode Toggle (if collection), Undo/Redo, Zoom, Quick Actions */}
        <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {/* View Mode Toggle when multi-image collection */}
          {isCollection && (collectionRef?.items.length ?? 0) > 1 ? (
            <div className="flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 mr-1">
              <button
                aria-label="Gallery view"
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                  viewMode === "gallery"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode("gallery")}
                type="button"
              >
                <LayoutGrid className="size-3" />
                <span className="hidden sm:inline">Gallery</span>
              </button>
              <button
                aria-label="Focus view"
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                  viewMode === "focus"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setViewMode("focus")}
                type="button"
              >
                <Eye className="size-3" />
                <span className="hidden sm:inline">Focus</span>
              </button>
            </div>
          ) : null}

          {/* Focus Mode Controls */}
          {viewMode === "focus" && (
            <>
              {/* History Undo / Redo */}
              {handleVersionChange && (totalVersions ?? 1) > 1 && (
                <div className="flex items-center gap-0.5 pr-1">
                  <button
                    className="rounded-lg p-1.5 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    disabled={!canUndo}
                    onClick={() => handleVersionChange("prev")}
                    title="Undo (Previous Version)"
                    type="button"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                  <button
                    className="rounded-lg p-1.5 hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    disabled={!canRedo}
                    onClick={() => handleVersionChange("next")}
                    title="Redo (Next Version)"
                    type="button"
                  >
                    <Redo2 className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Desktop Zoom Controls */}
              <div className="hidden md:flex items-center gap-1 border-l border-border/40 pl-1.5">
                <button
                  className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                  type="button"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <span className="w-8 text-center text-[10px] tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer"
                  onClick={handleZoomIn}
                  title="Zoom In"
                  type="button"
                >
                  <ZoomIn className="size-3.5" />
                </button>
                <button
                  className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer ml-0.5"
                  onClick={handleResetZoom}
                  title="Fit to Screen"
                  type="button"
                >
                  <Maximize2 className="size-3.5" />
                </button>
              </div>

              {/* Quick Actions: Copy, Download, Inspector Toggle */}
              <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
                <button
                  className="hidden sm:inline-flex rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
                  onClick={handleCopy}
                  title="Copy Image to Clipboard"
                  type="button"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  className="rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
                  onClick={handleDownload}
                  title="Download Image"
                  type="button"
                >
                  <Download className="size-3.5" />
                </button>
                <button
                  className={cn(
                    "hidden md:flex rounded p-1 hover:bg-muted hover:text-foreground cursor-pointer transition-colors ml-0.5",
                    isInspectorOpen && "bg-muted text-foreground"
                  )}
                  onClick={() => setIsInspectorOpen((prev) => !prev)}
                  title={isInspectorOpen ? "Hide Inspector" : "Show Inspector"}
                  type="button"
                >
                  <SlidersHorizontal className="size-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Desktop Tool Strip: Only shown in Focus mode ────── */}
      {viewMode === "focus" ? (
        <div className="hidden shrink-0 overflow-x-auto border-b border-border/60 bg-muted/10 [scrollbar-width:none] md:block [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto flex w-max items-center gap-1 px-3 py-1.5">
            {TOOL_MODES.map((mode) => {
              const isActive = activeToolMode === mode.key;
              return (
                <button
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-foreground font-semibold text-background shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={mode.key}
                  onClick={() => {
                    handleToolModeChange(mode.key);
                    setIsInspectorOpen(true);
                  }}
                  type="button"
                >
                  <span className="select-none text-xs">{mode.icon}</span>
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Guest Mode Alert Banner */}
      {isGuest ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3.5 py-1.5 text-xs text-amber-500">
          <div className="flex items-center gap-2">
            <Lock className="size-3.5 shrink-0" />
            <span className="font-medium text-[11px]">
              Guest Mode: Sign in to transform and save your images
            </span>
          </div>
          <button
            className="rounded bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/30 transition-colors cursor-pointer"
            onClick={() => setShowAuthModal(true)}
            type="button"
          >
            Sign In
          </button>
        </div>
      ) : null}

      {/* ─── Main Content: Gallery Grid or Focused Canvas + Inspector ──────── */}
      {viewMode === "gallery" && isCollection && collectionRef ? (
        <ImageGalleryGrid
          activeId={activeItem?.documentId}
          isProcessing={isProcessing}
          items={collectionRef.items}
          onBatchCompress={handleBatchCompress}
          onBatchConvertWebP={handleBatchConvertWebP}
          onBatchToPdf={handleBatchToPdf}
          onClearSelection={handleClearSelection}
          onCopyItem={handleCopyItem}
          onDownloadItem={handleDownloadItem}
          onFocusImage={handleFocusImage}
          onSelectAll={handleSelectAll}
          onToggleSelect={handleToggleSelect}
          selectedIds={selectedIds}
        />
      ) : (
        <div className="relative flex flex-1 overflow-hidden flex-col md:flex-row">
          {/* Left: Focused Image Canvas Area */}
          <div
            className={cn(
              // `overscroll-contain` keeps a pan or pinch that reaches the edge of
              // this box from chaining to the document, where the browser would read
              // it as pull-to-refresh and reload the whole studio out from under the
              // user mid-edit.
              "relative flex min-h-[220px] flex-1 items-center justify-center overflow-auto overscroll-contain bg-zinc-950/40 p-4",
              // Reserve the space the mobile bottom sheet covers so the whole crop
              // area stays visible and draggable while cropping.
              isCropping && isInspectorOpen && "pb-[56vh] md:pb-4"
            )}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onTouchStart={handleTouchStart}
          >
            {/* Mobile Zoom Pill */}
            <div className="absolute top-3 left-3 z-20 flex md:hidden items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2 py-0.5 shadow-sm backdrop-blur-md text-[10px] font-mono select-none">
              <button
                className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleZoomOut}
                type="button"
              >
                -
              </button>
              <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
              <button
                className="px-1 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleZoomIn}
                type="button"
              >
                +
              </button>
            </div>

            {isComparing && originalBase64 ? (
              <div className="size-full max-h-[75vh] flex items-center justify-center">
                <BeforeAfterSlider
                  afterLabel="Processed Photo"
                  afterSrc={formatSrc(currentBase64)}
                  beforeLabel="Original Photo"
                  beforeSrc={formatSrc(originalBase64)}
                  className="max-h-[70vh] rounded-lg shadow-lg border border-border/50"
                />
              </div>
            ) : (
              <div
                className="relative flex select-none items-center justify-center transition-transform duration-100"
                ref={imageContainerRef}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center",
                }}
              >
                {/*
                The frame is a ring (box-shadow) rather than a border on purpose:
                the crop shade is clipped to this box while the crop frame lives
                on the wrapper, so any inner border would offset the two by a
                pixel and the guides would stop lining up with the frame.
                The checkerboard is also swapped for a flat plate while cropping
                so its own 16px grid never competes with the crop guides.
              */}
                <div
                  className="relative overflow-hidden rounded-lg shadow-md ring-1 ring-border/40"
                  style={{
                    backgroundColor: "#09090b",
                    backgroundImage: isCropping
                      ? "none"
                      : `
                    linear-gradient(45deg, #18181b 25%, transparent 25%),
                    linear-gradient(-45deg, #18181b 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #18181b 75%),
                    linear-gradient(-45deg, transparent 75%, #18181b 75%)
                  `,
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                    backgroundSize: "16px 16px",
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: dynamic base64 preview */}
                  <img
                    alt={title || "Processed photo"}
                    className={cn(
                      "pointer-events-none max-w-full object-contain",
                      isCropping
                        ? "max-h-[30vh] md:max-h-[70vh]"
                        : "max-h-[70vh]"
                    )}
                    src={formatSrc(currentBase64)}
                  />

                  {/* Shading + guides for the crop selection, clipped to the image */}
                  {isCropping ? <CropShade box={cropBox} /> : null}
                </div>

                {/* Interactive crop frame: pointer-driven, so it works with touch */}
                {isCropping ? (
                  <CropOverlay
                    aspectK={cropAspectK}
                    box={cropBox}
                    naturalHeight={naturalHeight}
                    naturalWidth={naturalWidth}
                    onChange={setCropBox}
                    zoom={zoom}
                  />
                ) : null}
              </div>
            )}

            {/* Floating tool pill — mobile only; desktop has the tool strip above */}
            {!isInspectorOpen && (
              <div className="fixed bottom-6 left-1/2 z-40 w-[calc(100vw-32px)] -translate-x-1/2 select-none animate-in fade-in slide-in-from-bottom-3 duration-200 md:hidden">
                <div className="relative mx-auto">
                  <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 rounded-l-full bg-gradient-to-r from-background/90 to-transparent" />
                  <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 rounded-r-full bg-gradient-to-l from-background/90 to-transparent" />
                  <div className="flex h-14 items-center gap-1.5 overflow-x-auto scroll-smooth rounded-full border border-border/60 bg-background/85 px-3 py-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {TOOL_MODES.map((mode) => {
                      const isActive = activeToolMode === mode.key;
                      return (
                        <button
                          aria-label={mode.label}
                          className={cn(
                            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                            isActive
                              ? "scale-105 bg-foreground font-semibold text-background shadow-sm"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
                          )}
                          key={mode.key}
                          onClick={() => {
                            handleToolModeChange(mode.key);
                            setIsInspectorOpen(true);
                          }}
                          title={mode.label}
                          type="button"
                        >
                          <span className="text-base select-none leading-none">
                            {mode.icon}
                          </span>
                          <span>{mode.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right / Bottom: Focused Inspector Panel (Rounded Bottom Sheet on Mobile, Sidebar on Desktop) */}
          <div
            className={cn(
              // Mobile: Bottom Sheet with rounded top edges, border, backdrop blur, shadow, transform
              "absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border-t border-x border-border/70 bg-card/95 backdrop-blur-2xl shadow-[0_-12px_40px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-300 ease-out overscroll-contain",
              // Desktop: Sidebar on the right
              "md:relative md:inset-auto md:w-80 lg:w-84 md:rounded-none md:border-t-0 md:border-x-0 md:border-l md:border-border/60 md:bg-card/60 md:shadow-none",
              isInspectorOpen
                ? "translate-y-0 opacity-100 pointer-events-auto max-h-[62vh] md:max-h-none md:h-full"
                : "translate-y-full md:translate-y-0 md:w-0 md:opacity-0 md:overflow-hidden pointer-events-none md:pointer-events-none"
            )}
            style={{
              transform:
                isInspectorOpen && dragOffsetY > 0
                  ? `translateY(${dragOffsetY}px)`
                  : undefined,
              transition: isDragging ? "none" : undefined,
            }}
          >
            {/* Mobile Sheet Header with Tool Name and Exact Down Icon Button */}
            <div
              className="flex md:hidden items-center justify-between px-4 py-3 border-b border-border/40 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none overscroll-contain"
              onPointerCancel={handleDragCancel}
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
            >
              <div className="flex items-center gap-2">
                <span className="text-base select-none">
                  {activeToolObj?.icon}
                </span>
                <span className="font-semibold text-xs text-foreground tracking-tight">
                  {activeToolObj?.label} Settings
                </span>
              </div>
              <button
                aria-label="Minimize"
                className="size-8 rounded-full flex items-center justify-center bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/40"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsInspectorOpen(false);
                }}
                title="Minimize"
                type="button"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>

            {/* Desktop Sidebar Header */}
            <div className="hidden md:flex items-center justify-between px-3.5 py-2.5 border-b border-border/50 bg-muted/20 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm select-none">
                  {activeToolObj?.icon}
                </span>
                <span className="font-semibold text-xs text-foreground tracking-tight">
                  {activeToolObj?.label} Settings
                </span>
              </div>
            </div>

            {/* Scrollable Inspector Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y">
              {activeToolMode === "compress" && (
                <CompressionInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isComparing={isComparing}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  originalSrc={originalBase64}
                  setIsComparing={setIsComparing}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "resize" && (
                <ResizerInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "crop" && (
                <CropInspector
                  appliedParams={artifact.toolParams}
                  cropBox={cropBox}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  naturalHeight={naturalHeight}
                  naturalWidth={naturalWidth}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  originalSrc={originalBase64}
                  selectedAspect={selectedAspect}
                  setCropBox={setCropBox}
                  setIsProcessing={setIsProcessing}
                  setSelectedAspect={setSelectedAspect}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "remove_bg" && (
                <BackgroundRemovalInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isComparing={isComparing}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  originalSrc={originalBase64}
                  setIsComparing={setIsComparing}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "convert" && (
                <ConverterInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "upscale" && (
                <UpscalerInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "pixelate" && (
                <PixelatorInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "rotate" && (
                <RotatorInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  imageSrc={currentBase64}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  onRequireAuth={() => setShowAuthModal(true)}
                  onUpdateImage={handleUpdateImage}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}

              {activeToolMode === "ocr" && (
                <OcrInspector
                  appliedParams={artifact.toolParams}
                  documentId={currentDocId}
                  isGuest={isGuest}
                  isProcessing={isProcessing}
                  ocrText={artifact.ocrText}
                  onRequireAuth={() => setShowAuthModal(true)}
                  setIsProcessing={setIsProcessing}
                  versionIndex={currentVersionIndex}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <GuestAuthModal
        featureName={activeToolObj?.label || "Image Studio"}
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
