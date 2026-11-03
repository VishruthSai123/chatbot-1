"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  Loader2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ArtifactCloseButton } from "@/components/chat/artifact-close-button";
import { useArtifact } from "@/hooks/use-artifact";
import { deckFilename, deckToBlob } from "@/lib/slides/pptx";
import { decodeSlidesRef } from "@/lib/slides/ref";
import type { Slide } from "@/lib/slides/schema";
import {
  type SlideTheme,
  themeFor,
  themeIdFor,
  themeIds,
  themes,
} from "@/lib/slides/themes";
import { cn } from "@/lib/utils";

/**
 * The Slides Studio.
 *
 * The deck is rendered as HTML from the same JSON the .pptx is built from, so
 * what you see is what downloads. Text sizes are in container-query units, which
 * means the preview and the thumbnails scale together and nothing overflows at
 * any width.
 *
 * The download is built in the browser: the file is always current, and the
 * server never stores a binary it would have to invalidate on every edit.
 */

/** A slide, drawn to fill its container. */
function SlideCanvas({ slide, theme }: { slide: Slide; theme: SlideTheme }) {
  const padding = "5cqw";

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ color: theme.text, padding }}
    >
      {slide.layout === "title" ? (
        <div className="flex h-full flex-col justify-center">
          <div
            style={{
              backgroundColor: theme.accent,
              height: "0.8cqw",
              marginBottom: "2.4cqw",
              width: "12cqw",
            }}
          />
          <h1
            style={{
              fontFamily: theme.headingFont,
              fontSize: "7cqw",
              fontWeight: 700,
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {slide.title}
          </h1>
          {slide.subtitle ? (
            <p
              style={{
                color: theme.muted,
                fontFamily: theme.bodyFont,
                fontSize: "2.6cqw",
                marginTop: "1.6cqw",
              }}
            >
              {slide.subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      {slide.layout === "section" ? (
        <div className="flex h-full flex-col justify-center">
          <div
            style={{
              backgroundColor: theme.accent,
              height: "100%",
              left: 0,
              position: "absolute",
              top: 0,
              width: "1cqw",
            }}
          />
          <h2
            style={{
              fontFamily: theme.headingFont,
              fontSize: "5.4cqw",
              fontWeight: 700,
              lineHeight: 1.15,
              margin: 0,
            }}
          >
            {slide.title}
          </h2>
          {slide.subtitle ? (
            <p
              style={{
                color: theme.muted,
                fontFamily: theme.bodyFont,
                fontSize: "2.4cqw",
                marginTop: "1.2cqw",
              }}
            >
              {slide.subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      {slide.layout === "quote" ? (
        <div className="flex h-full flex-col justify-center">
          <p
            style={{
              fontFamily: theme.headingFont,
              fontSize: "4.2cqw",
              fontStyle: "italic",
              lineHeight: 1.35,
              margin: 0,
            }}
          >
            “{slide.quote?.text}”
          </p>
          {slide.quote?.attribution ? (
            <p
              style={{
                color: theme.muted,
                fontFamily: theme.bodyFont,
                fontSize: "2.2cqw",
                marginTop: "2cqw",
              }}
            >
              — {slide.quote.attribution}
            </p>
          ) : null}
        </div>
      ) : null}

      {slide.layout === "stat" ? (
        <div className="flex h-full flex-col justify-center">
          <p
            style={{
              color: theme.accent,
              fontFamily: theme.headingFont,
              fontSize: "13cqw",
              fontWeight: 700,
              lineHeight: 1,
              margin: 0,
            }}
          >
            {slide.stat?.value}
          </p>
          <p
            style={{
              color: theme.muted,
              fontFamily: theme.bodyFont,
              fontSize: "2.6cqw",
              marginTop: "1.4cqw",
            }}
          >
            {slide.stat?.label ?? slide.title}
          </p>
        </div>
      ) : null}

      {slide.layout === "two-column" ? (
        <div className="flex h-full flex-col">
          <h2
            style={{
              fontFamily: theme.headingFont,
              fontSize: "4.6cqw",
              fontWeight: 700,
              lineHeight: 1.15,
              margin: 0,
              marginBottom: "2.4cqw",
            }}
          >
            {slide.title}
          </h2>
          <div className="flex flex-1 gap-[3cqw]">
            {(slide.columns ?? []).slice(0, 2).map((column) => (
              <div className="flex-1" key={column.heading}>
                <p
                  style={{
                    color: theme.accent,
                    fontFamily: theme.headingFont,
                    fontSize: "2.6cqw",
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  {column.heading}
                </p>
                <p
                  style={{
                    color: theme.muted,
                    fontFamily: theme.bodyFont,
                    fontSize: "2.3cqw",
                    lineHeight: 1.4,
                    marginTop: "1cqw",
                  }}
                >
                  {column.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {slide.layout === "bullets" ? (
        <div className="flex h-full flex-col">
          <h2
            style={{
              fontFamily: theme.headingFont,
              fontSize: "4.6cqw",
              fontWeight: 700,
              lineHeight: 1.15,
              margin: 0,
              marginBottom: "2.4cqw",
            }}
          >
            {slide.title}
          </h2>
          <ul
            style={{
              color: theme.text,
              fontFamily: theme.bodyFont,
              fontSize: "2.7cqw",
              lineHeight: 1.5,
              margin: 0,
              paddingLeft: "3cqw",
            }}
          >
            {(slide.bullets ?? []).map((bullet) => (
              <li key={bullet} style={{ marginBottom: "1.2cqw" }}>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SlidesStudio({
  content,
  title,
}: {
  content: string;
  title?: string;
}) {
  const { artifact } = useArtifact();
  const ref = useMemo(() => decodeSlidesRef(content), [content]);
  const [index, setIndex] = useState(0);
  const [themeId, setThemeId] = useState(() => themeIdFor(ref?.theme));
  const [isDownloading, setIsDownloading] = useState(false);

  const theme = themeFor(themeId);
  const deck = ref?.deck;
  const slides = deck?.slides ?? [];
  const slide = slides[Math.min(index, Math.max(0, slides.length - 1))];
  const heading = deck?.title ?? title ?? artifact.title ?? "Presentation";

  const handleDownload = useCallback(async () => {
    if (!deck) {
      return;
    }

    setIsDownloading(true);
    const toastId = toast.loading("Building the PowerPoint file…");

    try {
      const blob = await deckToBlob(deck, themeId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.download = deckFilename(deck.title);
      link.href = url;
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("PowerPoint file ready", { id: toastId });
    } catch (error: any) {
      console.error("Deck export failed:", error);
      toast.error(error?.message ?? "The file could not be built.", {
        id: toastId,
      });
    } finally {
      setIsDownloading(false);
    }
  }, [deck, themeId]);

  if (!deck || slides.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        This presentation could not be read.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ArtifactCloseButton />
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[220px] truncate text-xs font-semibold tracking-tight md:text-sm">
              {heading}
            </span>
            <span className="font-mono text-[10px] leading-none text-muted-foreground">
              {slides.length} slides · {themes[themeId].name}
            </span>
          </div>
        </div>

        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          disabled={isDownloading}
          onClick={handleDownload}
          type="button"
        >
          {isDownloading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <DownloadIcon className="size-3" />
          )}
          Download .pptx
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Slide list */}
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-border/40 p-2 md:block">
          {slides.map((item, itemIndex) => (
            <button
              aria-label={`Slide ${itemIndex + 1}: ${item.title}`}
              className={cn(
                "mb-1.5 w-full cursor-pointer rounded-md border p-2 text-left transition-colors",
                itemIndex === index
                  ? "border-foreground/30 bg-muted"
                  : "border-border/50 hover:border-border hover:bg-muted/40"
              )}
              key={item.title}
              onClick={() => setIndex(itemIndex)}
              type="button"
            >
              <span className="font-mono text-[9px] text-muted-foreground/60">
                {String(itemIndex + 1).padStart(2, "0")}
              </span>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-foreground/80">
                {item.title}
              </p>
            </button>
          ))}
        </aside>

        {/* Preview */}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-3 md:p-6">
          <div
            className="relative aspect-video w-full max-w-3xl overflow-hidden rounded-lg border border-border/50"
            style={{
              backgroundColor: theme.background,
              containerType: "inline-size",
            }}
          >
            <SlideCanvas slide={slide} theme={theme} />
          </div>

          {/* Notes */}
          {slide.notes ? (
            <p className="w-full max-w-3xl rounded-md border border-border/40 bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="mr-1.5 font-medium text-foreground/70">
                Speaker notes
              </span>
              {slide.notes}
            </p>
          ) : null}

          {/* Pager, for narrow screens where the list is hidden */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              aria-label="Previous slide"
              className="cursor-pointer rounded-md border border-border/60 p-1.5 text-muted-foreground disabled:opacity-40"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              type="button"
            >
              <ChevronLeftIcon className="size-3.5" />
            </button>
            <span className="font-mono text-[10px] text-muted-foreground">
              {index + 1} / {slides.length}
            </span>
            <button
              aria-label="Next slide"
              className="cursor-pointer rounded-md border border-border/60 p-1.5 text-muted-foreground disabled:opacity-40"
              disabled={index >= slides.length - 1}
              onClick={() =>
                setIndex((value) => Math.min(slides.length - 1, value + 1))
              }
              type="button"
            >
              <ChevronRightIcon className="size-3.5" />
            </button>
          </div>
        </main>
      </div>

      {/* Theme */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/40 px-3 py-2">
        <span className="mr-1 font-mono text-[10px] text-muted-foreground">
          Theme
        </span>
        {themeIds.map((id) => (
          <button
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors",
              themeId === id
                ? "border-foreground/30 bg-muted text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            )}
            key={id}
            onClick={() => setThemeId(id)}
            type="button"
          >
            <span
              className="size-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: themes[id].background }}
            />
            {themes[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}
