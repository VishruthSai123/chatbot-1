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

interface GuestAuthModalProps {
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
  "Every tool unlocked — images, PDFs, sheets, audio, notebooks, slides",
  "Your files saved to a library you can come back to",
  "Chat history kept when you switch device",
];

export function GuestAuthModal({
  open,
  onOpenChange,
  featureName,
  description,
}: GuestAuthModalProps) {
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="overflow-hidden border-border/80 p-0 shadow-2xl sm:max-w-[440px]">
        <div className="flex flex-col p-6 sm:p-7">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
            <Lock className="size-4" />
          </div>

          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              {featureName ? `Unlock ${featureName}` : "Save your work"}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
              {description ??
                "You are browsing as a guest. Chatting is free; tools need a free account so what you make is kept."}
            </DialogDescription>
          </DialogHeader>

          <ul className="my-5 flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3.5 text-left">
            {HIGHLIGHTS.map((item) => (
              <li
                className="flex items-start gap-2 text-[12px] leading-snug text-foreground/85"
                key={item}
              >
                <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="flex w-full flex-col gap-2">
            <Button asChild className="w-full justify-center gap-2 font-medium">
              <Link href={`/register?next=${next}`} onClick={handleClose}>
                Create free account
                <ArrowRight className="size-4" />
              </Link>
            </Button>

            <Button asChild className="w-full justify-center" variant="outline">
              <Link href={`/login?next=${next}`} onClick={handleClose}>
                Sign in
              </Link>
            </Button>

            <Button
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Continue as guest
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
