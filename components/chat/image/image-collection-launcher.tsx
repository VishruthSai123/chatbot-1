"use client";

import { Images, Loader2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";

import { GuestAuthModal } from "@/components/chat/guest-auth-modal";
import { useArtifact } from "@/hooks/use-artifact";
import { useIsGuest } from "@/hooks/use-is-guest";
import { toolEndpoint } from "@/lib/tools/endpoint";
import type { Attachment } from "@/lib/types";

/**
 * Opens several attached images in one gallery.
 *
 * Until a collection exists, several uploaded photos are just several separate
 * documents: they can be edited one at a time, but there is no way to see them
 * together, compare them, or apply one operation to all of them. This button
 * creates the collection and mounts the studio on it.
 *
 * It is deliberately explicit rather than automatic. Grouping photos the moment
 * they are attached would take away the choice to treat them as unrelated
 * documents, and most people attach several images for entirely separate reasons.
 */
export const ImageCollectionLauncher = memo(
  function InnerImageCollectionLauncher({
    attachments,
  }: {
    attachments: Attachment[];
  }) {
    const { setArtifact } = useArtifact();
    const { isGuest } = useIsGuest();
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const images = attachments.filter(
      (attachment) =>
        attachment.contentType?.startsWith("image") && attachment.documentId
    );

    const handleOpenGallery = useCallback(async () => {
      if (isGuest) {
        setShowAuthModal(true);
        return;
      }

      const documentIds = images
        .map((attachment) => attachment.documentId)
        .filter((id): id is string => Boolean(id));

      if (documentIds.length < 2) {
        return;
      }

      setIsCreating(true);
      const toastId = toast.loading("Building the gallery…");

      try {
        const response = await fetch(toolEndpoint("image"), {
          body: JSON.stringify({
            action: "create_collection",
            params: { documentIds, title: "Gallery" },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        if (response.status === 403) {
          setShowAuthModal(true);
          return;
        }

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.result?.content) {
          throw new Error(payload?.error ?? "Could not build the gallery.");
        }

        setArtifact({
          boundingBox: { height: 0, left: 0, top: 0, width: 0 },
          content: payload.result.content,
          documentId: payload.documentId,
          isVisible: true,
          kind: "image",
          status: "idle",
          title: "Gallery",
        });

        toast.success(
          `Gallery ready — ${payload.items?.length ?? documentIds.length} images`,
          { id: toastId }
        );
      } catch (error: any) {
        toast.error(error.message ?? "Could not build the gallery.", {
          id: toastId,
        });
      } finally {
        setIsCreating(false);
      }
    }, [images, isGuest, setArtifact]);

    if (images.length < 2) {
      return null;
    }

    return (
      <>
        <button
          className="flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-muted text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus:outline-none"
          disabled={isCreating}
          onClick={handleOpenGallery}
          title="Open these images in one gallery"
          type="button"
        >
          {isCreating ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Images className="size-5" />
          )}
          <span className="px-1 text-center text-[9px] leading-tight">
            Gallery · {images.length}
          </span>
        </button>

        <GuestAuthModal
          featureName="Image Gallery"
          onOpenChange={setShowAuthModal}
          open={showAuthModal}
        />
      </>
    );
  }
);
