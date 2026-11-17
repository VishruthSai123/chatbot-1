"use client";

import { ArrowRight, Check, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GUEST_MESSAGE_LIMIT } from "@/lib/guest";

interface GuestAuthModalProps {
  allowGuestContinue?: boolean;
  description?: string;
  featureName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/**
 * What a guest sees when they reach something that needs an account.
 *
 * The copy is about what they gain, not what they are blocked from, and it is
 * the same for every tool — the dialog used to list image-editing features even
 * when the user had asked for a deck. Both paths carry `?next=` so signing up
 * returns them to the conversation they were in.
 */

const HIGHLIGHTS = [
  `${GUEST_MESSAGE_LIMIT} free guest messages to try Spire AI; a free account keeps the conversation`,
  "90 hosted AI tasks a month, plus 1 web search a month",
  "On-device image/PDF edits and device actions stay free and unlimited",
  "Guest chats and files are removed after 7 days; a free account keeps them",
];

export function GuestAuthModal({
  open,
  onOpenChange,
  featureName,
  description,
  allowGuestContinue = true,
}: GuestAuthModalProps) {
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[440px] overflow-hidden border-border/80 p-0 shadow-2xl sm:max-w-[440px]">
        <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-y-auto p-4 sm:p-7">
          <div className="mb-3 flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground sm:mb-4 sm:size-10">
            <Lock className="size-4" />
          </div>

          <DialogHeader className="space-y-1.5 pr-8">
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              {featureName ? `Unlock ${featureName}` : "Use Spire AI"}
            </DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">
              {description ??
                "Spire AI needs a free account. Quick Search local search, on-device tools and device actions stay free and accountless."}
            </DialogDescription>
          </DialogHeader>

          <ul className="my-4 flex w-full flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-3 text-left sm:my-5 sm:gap-2 sm:p-3.5">
            {HIGHLIGHTS.map((item) => (
              <li
                className="flex items-start gap-2 text-[11px] leading-snug text-foreground/85 sm:text-[12px]"
                key={item}
              >
                <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="flex w-full flex-col gap-2">
            <Button
              asChild
              className="min-h-10 w-full justify-center gap-2 font-medium"
            >
              <Link href={`/register?next=${next}`} onClick={handleClose}>
                Create free account
                <ArrowRight className="size-4" />
              </Link>
            </Button>

            <Button
              asChild
              className="min-h-10 w-full justify-center"
              variant="outline"
            >
              <Link href={`/login?next=${next}`} onClick={handleClose}>
                Sign in
              </Link>
            </Button>

            {allowGuestContinue ? (
              <Button
                className="w-full text-xs text-muted-foreground hover:text-foreground"
                onClick={handleClose}
                size="sm"
                type="button"
                variant="ghost"
              >
                Continue as guest
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
