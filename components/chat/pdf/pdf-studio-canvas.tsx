"use client";

import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  LayoutGrid,
  Loader2,
  RotateCw,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { normaliseDegrees } from "@/lib/pdf/pages";
import { formatBytes } from "@/lib/storage/limits";
import { toolEndpoint } from "@/lib/tools/endpoint";
import { cn } from "@/lib/utils";

/**
 * PDF Studio canvas.
 *
 * Thumbnails are drawn by pdf.js in the browser, but every *edit* runs server-side
 * through `pdf-lib`, so the operation that produces the file is the same one the
 * chat tools call. The canvas never posts bytes: it posts a page order, and the
 * server writes the result to storage and returns a reference.
 *
 * Two constraints shaped this component:
 *
 * 1. Every scroll container is `overscroll-contain`. A flick at the end of the grid
 *    must not chain to the document and trigger a mobile pull-to-refresh — the
 *    failure mode that made the image studio reload itself.
 * 2. Editing is *staged*. Reordering and rotating mutate local state; one "Apply"
 *    writes a single new version. A round trip per drag would re-upload and
 *    re-encode a multi-megabyte file for every pixel of movement.
 */

export interface PdfStudioCanvasProps {
  /** `pdf-ref:` envelope, or a bare storage key, from `Document.content`. */
  content: string;
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

type PageItem = {
  /** Aspect ratio width / height from the unrotated page */
  aspectRatio?: number;
  /** Stable identity across reorders, so React keeps the right canvas. */
  id: string;
  /** 1-based page number in the source document. */
  sourcePage: number;
  /** Rotation the user staged on top of the page's own rotation. */
  rotation: number;
  /** Rotation baked into the PDF itself. */
  intrinsic: number;
};

type ResolvedFile = {
  filename: string;
  pages: number;
  sizeBytes: number;
  storageKey: string;
  url: string;
};

type SplitPart = { filename: string; pages: number; url: string };

const THUMB_WIDTH = 180;

/** Same-origin prefix for pdf.js worker, CMaps, fonts and wasm codecs. */
const PDFJS_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/pdfjs`;

function signature(pages: PageItem[]): string {
  return pages.map((page) => `${page.sourcePage}:${page.rotation}`).join(",");
}

function getEffectiveAspect(
  intrinsicAspect = Math.SQRT1_2,
  rotation = 0
): number {
  const norm = normaliseDegrees(rotation);
  if (norm === 90 || norm === 270) {
    return 1 / (intrinsicAspect || Math.SQRT1_2);
  }
  return intrinsicAspect || Math.SQRT1_2;
}

/**
 * One lazily rendered page thumbnail.
 *
 * Lazy matters: a 300-page scan would otherwise draw 300 canvases on mount and
 * freeze the panel. An IntersectionObserver defers each render until the page is
 * near the viewport, and the render task is cancelled if the page scrolls away or
 * unmounts.
 */
const PageThumb = memo(function InnerPageThumb({
  doc,
  intrinsicAspect,
  rotation,
  sourcePage,
}: {
  doc: any;
  intrinsicAspect?: number;
  rotation: number;
  sourcePage: number;
}) {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const activeTaskRef = useRef<any>(null);
  // Default first 18 pages to visible so initial viewport renders immediately without waiting on IntersectionObserver
  const [visible, setVisible] = useState(() => sourcePage <= 18);
  const [isRendered, setIsRendered] = useState(false);
  const [aspect, setAspect] = useState<number>(() =>
    getEffectiveAspect(intrinsicAspect, rotation)
  );

  useEffect(() => {
    setAspect(getEffectiveAspect(intrinsicAspect, rotation));
  }, [intrinsicAspect, rotation]);

  // For pages beyond 18, use IntersectionObserver with a generous rootMargin and scroll fallback
  useEffect(() => {
    if (visible) {
      return;
    }

    const element = boxRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" }
    );

    observer.observe(element);

    // Fallback: Ensure page becomes visible after 1.5s regardless of observer triggers
    const timer = setTimeout(() => {
      setVisible(true);
    }, 1500);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [visible]);

  useEffect(() => {
    if (!(visible && doc && canvasEl)) {
      return;
    }

    let cancelled = false;

    const render = async () => {
      // Cancel and wait for any previous in-flight task on this canvas before starting
      if (activeTaskRef.current) {
        try {
          activeTaskRef.current.cancel();
          await activeTaskRef.current.promise.catch(() => undefined);
        } catch {
          // ignore
        }
        activeTaskRef.current = null;
      }

      if (cancelled) {
        return;
      }

      const page = await doc.getPage(sourcePage);

      if (cancelled) {
        return;
      }

      const angle = normaliseDegrees(page.rotate + rotation);
      const base = page.getViewport({ rotation: angle });
      const currentAspect = base.width / base.height;
      setAspect(currentAspect);

      const dpr =
        typeof window === "undefined"
          ? 2
          : Math.min(window.devicePixelRatio || 2, 3);
      const containerWidth = boxRef.current?.clientWidth || THUMB_WIDTH;
      const targetWidth = Math.max(containerWidth, THUMB_WIDTH);
      const scale = (targetWidth / base.width) * dpr;

      const viewport = page.getViewport({
        rotation: angle,
        scale,
      });

      const context = canvasEl.getContext("2d");

      if (!context || cancelled) {
        return;
      }

      canvasEl.width = Math.max(1, Math.floor(viewport.width));
      canvasEl.height = Math.max(1, Math.floor(viewport.height));

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasEl.width, canvasEl.height);

      const renderTask = page.render({
        background: "rgb(255, 255, 255)",
        canvasContext: context,
        viewport,
      });

      activeTaskRef.current = renderTask;
      await renderTask.promise;

      if (!cancelled) {
        setIsRendered(true);
      }
    };

    render().catch((error) => {
      if (error?.name === "RenderingCancelledException") {
        return;
      }
      console.warn(`Page ${sourcePage} could not be rendered:`, error);
    });

    return () => {
      cancelled = true;
      if (activeTaskRef.current) {
        try {
          activeTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [canvasEl, doc, rotation, sourcePage, visible]);

  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden rounded-md bg-white shadow-xs transition-all hover:shadow-md border border-border/60"
      ref={boxRef}
      style={{ aspectRatio: `${aspect}` }}
    >
      <canvas
        className={cn(
          "h-full w-full object-contain select-none transition-opacity duration-200",
          isRendered ? "opacity-100" : "opacity-0"
        )}
        ref={setCanvasEl}
      />
      {isRendered ? null : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/20 animate-pulse">
          <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
        </div>
      )}
    </div>
  );
});

/**
 * High-resolution single-page Document Reader.
 *
 * Provides a dedicated reading mode where pages are rendered at full crispness
 * with paper elevation, zoom controls, and page navigation.
 */
const PageReader = memo(function InnerPageReader({
  doc,
  pageNumber,
  rotation,
  zoom,
}: {
  doc: any;
  pageNumber: number;
  rotation: number;
  zoom: number;
}) {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [aspect, setAspect] = useState<number>(Math.SQRT1_2);
  const [isRendering, setIsRendering] = useState(true);
  const activeTaskRef = useRef<any>(null);

  useEffect(() => {
    if (!doc || !canvasEl) {
      return;
    }

    let cancelled = false;
    setIsRendering(true);

    const render = async () => {
      if (activeTaskRef.current) {
        try {
          activeTaskRef.current.cancel();
          await activeTaskRef.current.promise.catch(() => undefined);
        } catch {
          // ignore
        }
        activeTaskRef.current = null;
      }

      if (cancelled) {
        return;
      }

      const page = await doc.getPage(pageNumber);
      if (cancelled) {
        return;
      }

      const angle = normaliseDegrees(page.rotate + rotation);
      const base = page.getViewport({ rotation: angle });
      const pageAspect = base.width / base.height;
      setAspect(pageAspect);

      const dpr =
        typeof window === "undefined"
          ? 2
          : Math.min(window.devicePixelRatio || 2, 3);
      const baseWidth = 680;
      const scaledWidth = baseWidth * (zoom / 100);
      const scale = (scaledWidth / base.width) * dpr;

      const viewport = page.getViewport({ rotation: angle, scale });
      const context = canvasEl.getContext("2d");

      if (!context || cancelled) {
        return;
      }

      canvasEl.width = Math.max(1, Math.floor(viewport.width));
      canvasEl.height = Math.max(1, Math.floor(viewport.height));

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasEl.width, canvasEl.height);

      const renderTask = page.render({
        background: "rgb(255, 255, 255)",
        canvasContext: context,
        viewport,
      });

      activeTaskRef.current = renderTask;
      await renderTask.promise;

      if (!cancelled) {
        setIsRendering(false);
      }
    };

    render().catch((err) => {
      if (err?.name === "RenderingCancelledException") {
        return;
      }
      console.warn("Reader render failed:", err);
      if (!cancelled) {
        setIsRendering(false);
      }
    });

    return () => {
      cancelled = true;
      if (activeTaskRef.current) {
        try {
          activeTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [canvasEl, doc, pageNumber, rotation, zoom]);

  const targetWidthPx = Math.round(680 * (zoom / 100));

  return (
    <div className="flex min-h-full w-full items-center justify-center p-4 md:p-8 overflow-auto overscroll-contain bg-muted/20">
      <div
        className="relative mx-auto rounded-lg bg-white shadow-xl border border-border/70 transition-all duration-150"
        style={{
          aspectRatio: `${aspect}`,
          maxWidth: "100%",
          width: `${targetWidthPx}px`,
        }}
      >
        <canvas
          className="h-full w-full rounded-lg object-contain select-none"
          ref={setCanvasEl}
        />
        {isRendering ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/30 backdrop-blur-xs">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
});

function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

/** Downloads through the signed URL, falling back to a new tab if CORS blocks it. */
async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Download failed");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.download = filename;
    link.href = objectUrl;
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PdfStudioCanvas = memo(function InnerPdfStudioCanvas({
  content,
  currentVersionIndex = 0,
  documentId: propDocumentId,
  title,
  totalVersions = 1,
  handleVersionChange,
  onSaveContent,
}: PdfStudioCanvasProps) {
  const { artifact, setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState(false);

  const documentId = useMemo(() => {
    if (propDocumentId && UUID_REGEX.test(propDocumentId)) {
      return propDocumentId;
    }
    if (
      artifact.documentId &&
      artifact.documentId !== "init" &&
      UUID_REGEX.test(artifact.documentId)
    ) {
      return artifact.documentId;
    }
  }, [propDocumentId, artifact.documentId]);

  const [source, setSource] = useState<ResolvedFile | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [originalSignature, setOriginalSignature] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "reader">("grid");
  const [readerPage, setReaderPage] = useState<number>(1);
  const [readerZoom, setReaderZoom] = useState<number>(100);

  useEffect(() => {
    if (viewMode !== "reader") {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setReaderPage((prev) => Math.max(1, prev - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setReaderPage((prev) => Math.min(pages.length, prev + 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pages.length, viewMode]);

  const request = useCallback(
    async (action: string, params?: Record<string, unknown>) => {
      const response = await fetch(toolEndpoint("pdf"), {
        body: JSON.stringify({
          action,
          content,
          documentId,
          params,
          versionIndex: currentVersionIndex,
        }),
        headers: authHeaders(),
        method: "POST",
      });

      if (response.status === 403) {
        setShowAuthModal(true);
        return null;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "The PDF tool failed.");
      }

      return payload;
    },
    [content, currentVersionIndex, documentId]
  );

  /** Resolves the current version to a signed URL the browser can read. */
  useEffect(() => {
    let cancelled = false;

    if (isGuest) {
      setIsLoading(false);
      return;
    }

    if (!documentId && !content) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setDoc(null);
    setPages([]);
    setSelected(new Set());
    setExtractedText(null);
    setSplitParts([]);

    request("resolve")
      .then((payload) => {
        if (cancelled) {
          return;
        }

        if (!payload?.result?.url) {
          if (
            content?.startsWith("http://") ||
            content?.startsWith("https://")
          ) {
            setSource({
              filename: title || "document.pdf",
              pages: 1,
              sizeBytes: 0,
              storageKey: content,
              url: content,
            });
            return;
          }
          setError("This version has no file attached yet.");
          setIsLoading(false);
          return;
        }

        setSource(payload.result as ResolvedFile);
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          if (
            content?.startsWith("http://") ||
            content?.startsWith("https://")
          ) {
            setSource({
              filename: title || "document.pdf",
              pages: 1,
              sizeBytes: 0,
              storageKey: content,
              url: content,
            });
          } else {
            setError(cause.message);
            setIsLoading(false);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, documentId, isGuest, request, title]);

  /** Loads the document into pdf.js and derives the editable page list. */
  useEffect(() => {
    if (!source?.url) {
      return;
    }

    let cancelled = false;
    let loadingTask: any = null;

    const load = async () => {
      const pdfjs = await import("pdfjs-dist");

      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;

      let loaded: any;
      try {
        loadingTask = pdfjs.getDocument({
          cMapPacked: true,
          cMapUrl: `${PDFJS_BASE}/cmaps/`,
          standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
          url: source.url,
          verbosity: 0,
          wasmUrl: `${PDFJS_BASE}/wasm/`,
        });

        loaded = await loadingTask.promise;
      } catch (err: any) {
        // Fallback: If range request or worker stream fails (e.g. CORS on Range header), fetch buffer directly
        try {
          const res = await fetch(source.url);
          if (!res.ok) {
            throw err;
          }
          const buf = await res.arrayBuffer();
          loadingTask = pdfjs.getDocument({
            cMapPacked: true,
            cMapUrl: `${PDFJS_BASE}/cmaps/`,
            data: new Uint8Array(buf),
            standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
            verbosity: 0,
            wasmUrl: `${PDFJS_BASE}/wasm/`,
          });
          loaded = await loadingTask.promise;
        } catch (fallbackErr) {
          throw new Error(
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr),
            { cause: fallbackErr }
          );
        }
      }

      if (cancelled) {
        return;
      }

      const pageNumbers = Array.from(
        { length: loaded.numPages },
        (_, i) => i + 1
      );
      const loadedPages = await Promise.all(
        pageNumbers.map((num) => loaded.getPage(num))
      );

      const items: PageItem[] = loadedPages.map((page, index) => {
        const vp = page.getViewport({
          rotation: normaliseDegrees(page.rotate),
        });
        return {
          aspectRatio: vp.width / vp.height,
          id: `page-${index + 1}`,
          intrinsic: normaliseDegrees(page.rotate),
          rotation: 0,
          sourcePage: index + 1,
        };
      });

      if (cancelled) {
        return;
      }

      setDoc(loaded);
      setPages(items);
      setOriginalSignature(signature(items));
      setIsLoading(false);
    };

    load().catch((cause) => {
      if (cancelled) {
        return;
      }

      setError(
        cause?.name === "PasswordException"
          ? "This document is password protected and cannot be opened."
          : "This document could not be rendered."
      );
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [source?.url]);

  const isDirty = useMemo(
    () => pages.length > 0 && signature(pages) !== originalSignature,
    [originalSignature, pages]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const movePage = useCallback((id: string, direction: -1 | 1) => {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === id);
      const target = index + direction;

      if (index < 0 || target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);

      return next;
    });
  }, []);

  /** Rotates the selection, or every page when nothing is selected. */
  const rotate = useCallback(() => {
    setPages((current) =>
      current.map((page) =>
        selected.size === 0 || selected.has(page.id)
          ? { ...page, rotation: normaliseDegrees(page.rotation + 90) }
          : page
      )
    );
  }, [selected]);

  const removeSelected = useCallback(() => {
    setPages((current) => {
      const next = current.filter((page) => !selected.has(page.id));

      // A PDF with zero pages is not a valid document; keep the last one.
      if (next.length === 0) {
        toast.error("A document needs at least one page");
        return current;
      }

      return next;
    });
    setSelected(new Set());
  }, [selected]);

  const reset = useCallback(() => {
    setPages((current) =>
      [...current]
        .sort((a, b) => a.sourcePage - b.sourcePage)
        .map((page) => ({ ...page, rotation: 0 }))
    );
    setSelected(new Set());
  }, []);

  const apply = useCallback(async () => {
    if (isGuest) {
      setShowAuthModal(true);
      return;
    }

    if (!(isDirty && documentId)) {
      return;
    }

    setIsWorking(true);

    try {
      const rotations = Object.fromEntries(
        pages
          .filter((page) => page.rotation !== 0)
          .map((page) => [
            String(page.sourcePage),
            // The server replaces a page's rotation, so the staged turn has to be
            // added to the angle already baked into the file — otherwise rotating
            // an already-sideways page would appear to do nothing.
            normaliseDegrees(page.intrinsic + page.rotation),
          ])
      );

      const payload = await request("arrange", {
        pageOrder: pages.map((page) => page.sourcePage),
        rotations,
      });

      if (!payload) {
        return;
      }

      const nextContent = `pdf-ref:${JSON.stringify({
        pages: payload.result?.pages,
        storageKey: payload.result?.storageKey,
      })}`;

      toast.success(
        `Saved a ${payload.result?.pages ?? pages.length}-page document`
      );

      onSaveContent?.(nextContent, false, { persisted: true });
      setArtifact((current) => ({ ...current, content: nextContent }));
    } catch (cause: any) {
      toast.error(cause.message ?? "Could not apply the changes.");
    } finally {
      setIsWorking(false);
    }
  }, [
    documentId,
    isDirty,
    isGuest,
    onSaveContent,
    pages,
    request,
    setArtifact,
  ]);

  const extractText = useCallback(async () => {
    setIsWorking(true);

    try {
      const payload = await request("extract_text");

      if (!payload) {
        return;
      }

      setExtractedText(payload.text?.text ?? "");
    } catch (cause: any) {
      toast.error(cause.message ?? "Could not extract text.");
    } finally {
      setIsWorking(false);
    }
  }, [request]);

  const splitSelected = useCallback(async () => {
    if (selected.size === 0) {
      toast.error("Select the pages to extract first");
      return;
    }

    setIsWorking(true);

    try {
      // Selection is a set of page ids; convert to the 1-based order the API
      // expects, preserving document order rather than click order.
      const ranges = pages
        .filter((page) => selected.has(page.id))
        .map((page) => String(page.sourcePage))
        .join(",");

      const payload = await request("split", { pageRanges: ranges });

      if (!payload) {
        return;
      }

      const parts: SplitPart[] = [payload.result, ...(payload.results ?? [])]
        .filter(Boolean)
        .map((part: any) => ({
          filename: part.filename,
          pages: part.pages,
          url: part.url,
        }));

      setSplitParts(parts);
      toast.success(
        `Extracted ${parts.reduce((total, part) => total + part.pages, 0)} pages`
      );
    } catch (cause: any) {
      toast.error(cause.message ?? "Could not extract those pages.");
    } finally {
      setIsWorking(false);
    }
  }, [pages, request, selected]);

  const busy = isLoading || isWorking;

  if (isGuest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <FileText className="size-8 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium text-foreground">PDF Studio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in to merge, split, rotate and extract pages.
          </p>
        </div>
        <button
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 cursor-pointer"
          onClick={() => setShowAuthModal(true)}
          type="button"
        >
          Sign in
        </button>
        <GuestAuthModal
          featureName="PDF Studio"
          onOpenChange={setShowAuthModal}
          open={showAuthModal}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden overscroll-none bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span className="max-w-[130px] truncate text-xs font-semibold tracking-tight text-foreground sm:max-w-[200px] md:max-w-xs md:text-sm">
                {artifact.title || title || source?.filename || "document.pdf"}
              </span>
              {totalVersions > 1 ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                  v{currentVersionIndex + 1}/{totalVersions}
                </span>
              ) : null}
            </div>
            <span className="truncate font-mono text-[10px] leading-none text-muted-foreground">
              {source
                ? `${source.pages} ${source.pages === 1 ? "page" : "pages"} · ${formatBytes(source.sizeBytes)}`
                : "Loading…"}
              {isDirty ? " · unsaved changes" : ""}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {handleVersionChange && totalVersions > 1 ? (
            <div className="flex items-center gap-0.5 pr-1">
              <button
                aria-label="Previous version"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 cursor-pointer"
                disabled={currentVersionIndex <= 0}
                onClick={() => handleVersionChange("prev")}
                type="button"
              >
                <ArrowUp className="size-3.5 -rotate-90" />
              </button>
              <button
                aria-label="Next version"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 cursor-pointer"
                disabled={currentVersionIndex >= totalVersions - 1}
                onClick={() => handleVersionChange("next")}
                type="button"
              >
                <ArrowDown className="size-3.5 -rotate-90" />
              </button>
            </div>
          ) : null}

          {isDirty ? (
            <button
              className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={reset}
              type="button"
            >
              Reset
            </button>
          ) : null}

          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={!source}
            onClick={() => {
              if (source) {
                downloadFile(source.url, source.filename).catch(
                  () => undefined
                );
              }
            }}
            type="button"
          >
            <Download className="size-3" />
            Download
          </button>

          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
            disabled={busy || !isDirty}
            onClick={apply}
            type="button"
          >
            {isWorking ? <Loader2 className="size-3 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>

      {/* Page-level actions & View Mode switcher */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border/40 px-2 py-1">
        {/* Left: View Mode Toggle */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5">
            <button
              aria-label="Grid view"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                viewMode === "grid"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setViewMode("grid")}
              type="button"
            >
              <LayoutGrid className="size-3" />
              Grid
            </button>
            <button
              aria-label="Reader view"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                viewMode === "reader"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={pages.length === 0}
              onClick={() => setViewMode("reader")}
              type="button"
            >
              <BookOpen className="size-3" />
              Reader
            </button>
          </div>

          {viewMode === "reader" && pages.length > 0 ? (
            <div className="flex items-center gap-0.5 border-l border-border/40 pl-1.5">
              <button
                aria-label="Previous page"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={readerPage <= 1}
                onClick={() => setReaderPage((p) => Math.max(1, p - 1))}
                type="button"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {readerPage} / {pages.length}
              </span>
              <button
                aria-label="Next page"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={readerPage >= pages.length}
                onClick={() =>
                  setReaderPage((p) => Math.min(pages.length, p + 1))
                }
                type="button"
              >
                <ChevronRight className="size-3.5" />
              </button>
              <span className="mx-1 h-3 w-px bg-border" />
              <button
                aria-label="Zoom out"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={readerZoom <= 50}
                onClick={() => setReaderZoom((z) => Math.max(50, z - 25))}
                type="button"
              >
                <ZoomOut className="size-3.5" />
              </button>
              <span className="font-mono text-[10px] text-muted-foreground w-7 text-center">
                {readerZoom}%
              </span>
              <button
                aria-label="Zoom in"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                disabled={readerZoom >= 200}
                onClick={() => setReaderZoom((z) => Math.min(200, z + 25))}
                type="button"
              >
                <ZoomIn className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {viewMode === "grid" ? (
            <>
              <button
                className="cursor-pointer rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() =>
                  setSelected(
                    selected.size === pages.length
                      ? new Set()
                      : new Set(pages.map((page) => page.id))
                  )
                }
                type="button"
              >
                {selected.size === pages.length && pages.length > 0
                  ? "Clear"
                  : "Select all"}
              </button>
              <span className="mx-0.5 h-3 w-px bg-border" />
              <button
                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                disabled={busy || pages.length === 0}
                onClick={rotate}
                type="button"
              >
                <RotateCw className="size-3" />
                Rotate
              </button>
              <button
                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                disabled={busy || selected.size === 0}
                onClick={removeSelected}
                type="button"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
              <button
                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                disabled={busy || selected.size === 0}
                onClick={splitSelected}
                type="button"
              >
                <Scissors className="size-3" />
                Extract
              </button>
            </>
          ) : (
            <button
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              disabled={busy || pages.length === 0}
              onClick={() => {
                const currentPageItem = pages[readerPage - 1];
                if (currentPageItem) {
                  setPages((current) =>
                    current.map((item) =>
                      item.id === currentPageItem.id
                        ? {
                            ...item,
                            rotation: normaliseDegrees(item.rotation + 90),
                          }
                        : item
                    )
                  );
                }
              }}
              type="button"
            >
              <RotateCw className="size-3" />
              Rotate Page
            </button>
          )}

          <button
            className="ml-1 flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={busy}
            onClick={extractText}
            type="button"
          >
            <FileText className="size-3" />
            Text
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overscroll-contain">
        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              Try opening a different version, or upload the file again.
            </p>
          </div>
        ) : extractedText === null ? (
          viewMode === "grid" ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              {isLoading && pages.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Rendering pages…
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                  {pages.map((page, index) => {
                    const isSelected = selected.has(page.id);

                    return (
                      <div
                        className={cn(
                          "group relative overflow-hidden rounded-lg border bg-card transition-colors",
                          isSelected
                            ? "border-foreground ring-1 ring-foreground"
                            : "border-border/60 hover:border-foreground/40"
                        )}
                        key={page.id}
                      >
                        <button
                          aria-label={`Select page ${index + 1}`}
                          aria-pressed={isSelected}
                          className="block w-full cursor-pointer"
                          onClick={() => toggleSelected(page.id)}
                          onDoubleClick={() => {
                            setReaderPage(index + 1);
                            setViewMode("reader");
                          }}
                          type="button"
                        >
                          <div className="relative">
                            <PageThumb
                              doc={doc}
                              intrinsicAspect={page.aspectRatio}
                              rotation={page.rotation}
                              sourcePage={page.sourcePage}
                            />
                            <span className="absolute top-1 left-1 rounded bg-background/85 px-1.5 py-0.5 font-medium text-[10px] text-foreground tabular-nums">
                              {index + 1}
                            </span>
                          </div>
                        </button>

                        {/* Per-page controls sit outside the selection button so a tap
                            on a control never also toggles the page. */}
                        <div className="flex items-center justify-between border-t border-border/40 px-1 py-0.5">
                          <div className="flex items-center">
                            <button
                              aria-label={`Move page ${index + 1} earlier`}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => movePage(page.id, -1)}
                              type="button"
                            >
                              <ArrowUp className="size-3" />
                            </button>
                            <button
                              aria-label={`Move page ${index + 1} later`}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                              disabled={index === pages.length - 1}
                              onClick={() => movePage(page.id, 1)}
                              type="button"
                            >
                              <ArrowDown className="size-3" />
                            </button>
                          </div>
                          <div className="flex items-center">
                            <button
                              aria-label={`Inspect page ${index + 1}`}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() => {
                                setReaderPage(index + 1);
                                setViewMode("reader");
                              }}
                              type="button"
                            >
                              <Eye className="size-3" />
                            </button>
                            <button
                              aria-label={`Rotate page ${index + 1}`}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() =>
                                setPages((current) =>
                                  current.map((item) =>
                                    item.id === page.id
                                      ? {
                                          ...item,
                                          rotation: normaliseDegrees(
                                            item.rotation + 90
                                          ),
                                        }
                                      : item
                                  )
                                )
                              }
                              type="button"
                            >
                              <RotateCw className="size-3" />
                            </button>
                            <button
                              aria-label={`Delete page ${index + 1}`}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                              onClick={() => {
                                setPages((current) => {
                                  const next = current.filter(
                                    (item) => item.id !== page.id
                                  );

                                  if (next.length === 0) {
                                    toast.error(
                                      "A document needs at least one page"
                                    );
                                    return current;
                                  }

                                  return next;
                                });
                              }}
                              type="button"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {isLoading && pages.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Rendering page…
                </div>
              ) : (
                <PageReader
                  doc={doc}
                  pageNumber={pages[readerPage - 1]?.sourcePage ?? 1}
                  rotation={pages[readerPage - 1]?.rotation ?? 0}
                  zoom={readerZoom}
                />
              )}
            </div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
              <span className="text-[11px] font-medium text-foreground">
                Extracted text
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="cursor-pointer rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(extractedText)
                      .then(() => toast.success("Copied to clipboard"))
                      .catch(() => toast.error("Could not copy"));
                  }}
                  type="button"
                >
                  Copy
                </button>
                <button
                  className="cursor-pointer rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setExtractedText(null)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto overscroll-contain whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {extractedText || "No selectable text in this document."}
            </pre>
          </div>
        )}

        {splitParts.length > 0 ? (
          <div className="shrink-0 border-t border-border/40 bg-muted/20 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-foreground">
                Extracted files
              </span>
              <button
                className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setSplitParts([])}
                type="button"
              >
                Dismiss
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {splitParts.map((part) => (
                <button
                  className="flex cursor-pointer items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  key={part.filename}
                  onClick={() => {
                    downloadFile(part.url, part.filename).catch(
                      () => undefined
                    );
                  }}
                  type="button"
                >
                  <Download className="size-2.5" />
                  {part.filename} · {part.pages}p
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <GuestAuthModal
        featureName="PDF Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
});
