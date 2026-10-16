"use client";

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
  const { name, url, contentType } = attachment;
  const { setArtifact } = useArtifact();
  const { isGuest } = useIsGuest();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  const handleOpenStudio = useCallback(() => {
    if (isUploading || !contentType?.startsWith("image")) {
      return;
    }
    if (isGuest) {
      setShowAuthModal(true);
      return;
    }
    setArtifact({
      boundingBox: { height: 0, left: 0, top: 0, width: 0 },
      content: url,
      documentId: generateUUID(),
      isVisible: true,
      kind: "image",
      status: "idle",
      title: name || "Image Studio",
    });
  }, [isUploading, contentType, isGuest, setArtifact, url, name]);

  const isImage = contentType?.startsWith("image");

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
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground text-xs">
          File
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
