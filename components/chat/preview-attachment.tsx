"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import type { Attachment } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { Spinner } from "../ui/spinner";
import { CrossSmallIcon } from "./icons";

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType, documentId } = attachment;
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // The extension is checked alongside the media type, and the extension wins:
  // browsers routinely report a PDF as `application/octet-stream`, and a file
  // whose type is unknown should still open in the right studio.
  const isImage =
    contentType?.startsWith("image") ||
    (!contentType &&
      /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)$/i.test(name ?? ""));
  const isPdf = contentType === "application/pdf" || /\.pdf$/i.test(name ?? "");
  const isSheet =
    !isImage &&
    !isPdf &&
    /\.(csv|tsv|tab|xlsx|xlsm)$/i.test(name ?? "") === true;
  const isDoc =
    !isImage &&
    !isPdf &&
    !isSheet &&
    /\.(docx|md|markdown|txt|text)$/i.test(name ?? "") === true;

  const handleOpenStudio = useCallback(() => {
    if (isUploading || !(isImage || isPdf || isSheet || isDoc)) {
      return;
    }
    if (isGuest) {
      setShowAuthModal(true);
      return;
    }
    setArtifact({
      boundingBox: { height: 0, left: 0, top: 0, width: 0 },
      content: url,
      documentId: documentId || generateUUID(),
      isVisible: true,
      kind: isImage ? "image" : isPdf ? "pdf" : isSheet ? "sheet" : "doc",
      status: "idle",
      title:
        name ||
        (isSheet ? "Data Studio" : isDoc ? "Document Studio" : "Image Studio"),
    });
  }, [
    isUploading,
    isImage,
    isPdf,
    isSheet,
    isDoc,
    isGuest,
    setArtifact,
    url,
    name,
    documentId,
  ]);

  return (
    <div
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted"
      data-testid="input-attachment-preview"
    >
      {isImage ? (
        <button
          className="size-full cursor-pointer focus:outline-none"
          onClick={handleOpenStudio}
          title="Click to open in Image Studio"
          type="button"
        >
          <Image
            alt={name ?? "attachment"}
            className="size-full object-cover transition-transform group-hover:scale-105"
            height={96}
            src={url}
            unoptimized
            width={96}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
            <span className="rounded bg-sky-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
              Studio
            </span>
          </div>
        </button>
      ) : isPdf ? (
        <button
          className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
          onClick={handleOpenStudio}
          title="Click to open in PDF Studio"
          type="button"
        >
          <FileText className="size-6" />
          <span className="px-1 text-center text-[9px] leading-tight">
            {name ?? "PDF"}
          </span>
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
            <span className="rounded bg-sky-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
              Studio
            </span>
          </span>
        </button>
      ) : isSheet ? (
        <button
          className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
          onClick={handleOpenStudio}
          title="Click to open in Data Studio"
          type="button"
        >
          <FileSpreadsheet className="size-6" />
          <span className="px-1 text-center text-[9px] leading-tight">
            {name ?? "Sheet"}
          </span>
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
            <span className="rounded bg-sky-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
              Studio
            </span>
          </span>
        </button>
      ) : isDoc ? (
        <button
          className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
          onClick={handleOpenStudio}
          title="Click to open in Document Studio"
          type="button"
        >
          <FileText className="size-6" />
          <span className="px-1 text-center text-[9px] leading-tight">
            {name ?? "Document"}
          </span>
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
            <span className="rounded bg-sky-600/90 px-1 py-0.5 text-[9px] font-semibold text-white shadow">
              Studio
            </span>
          </span>
        </button>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-muted-foreground">
          <FileText className="size-5" />
          {/* The filename, not a generic label: the user has to be able to tell
              their attachments apart, and the model reads the same name. */}
          <span className="line-clamp-2 text-[9px] leading-tight">
            {name ?? "File"}
          </span>
        </div>
      )}

      {isUploading ? (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Spinner className="size-5" />
        </div>
      ) : null}

      {onRemove && !isUploading && (
        <button
          className="absolute top-1.5 right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          type="button"
        >
          <CrossSmallIcon size={10} />
        </button>
      )}

      <GuestAuthModal
        featureName="Image Studio"
        onOpenChange={setShowAuthModal}
        open={showAuthModal}
      />
    </div>
  );
};
