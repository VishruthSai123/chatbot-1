"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatSupportsAlpha } from "@/lib/image/formats";
import { imageHasTransparency } from "@/lib/image/transparency";

/**
 * Whether the image currently on screen has a transparent background. Drives the
 * studio's format defaults and the reassurance shown by tools that cannot lose it.
 */
export function useImageTransparency(src: string): boolean {
  const [transparent, setTransparent] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const value = await imageHasTransparency(src);
      if (!cancelled) {
        setTransparent(value);
      }
    };

    run().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [src]);

  return transparent;
}

/**
 * Asks before an action drops a transparent background.
 *
 * Removing a background is expensive and easy to ruin: an encoder without an
 * alpha channel does not just lose the transparency, it puts the removed
 * background back, because the cutout's colour channels still hold the pixels that
 * were cut away. The server refuses to do that on its own (see
 * {@link resolveAlphaFormat}); this hook is the one place the user can overrule it
 * deliberately, and it only interrupts when there is a real choice to make.
 */
export function useAlphaGuard(src: string) {
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);

  const settle = useCallback((proceed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPendingFormat(null);
    resolve?.(proceed);
  }, []);

  // An inspector can unmount while its confirmation is open (tool switch, closing
  // the studio). Resolve it so the awaiting handler cannot hang forever.
  useEffect(
    () => () => {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(false);
    },
    []
  );

  const confirmAlphaLoss = useCallback(
    async (format: string): Promise<boolean> => {
      if (formatSupportsAlpha(format) || !(await imageHasTransparency(src))) {
        return true;
      }

      return await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setPendingFormat(format);
      });
    },
    [src]
  );

  const alphaDialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          settle(false);
        }
      }}
      open={pendingFormat !== null}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">
            Lose the transparent background?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed">
            {(pendingFormat ?? "JPEG").toUpperCase()} cannot store transparency,
            so the transparent area would be filled with solid white. Cancel
            keeps the image exactly as it is.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className="cursor-pointer"
            onClick={() => settle(false)}
            size="sm"
          >
            Keep transparent
          </AlertDialogCancel>
          <AlertDialogAction
            className="cursor-pointer"
            onClick={() => settle(true)}
            size="sm"
          >
            Fill with white
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { alphaDialog, confirmAlphaLoss };
}
