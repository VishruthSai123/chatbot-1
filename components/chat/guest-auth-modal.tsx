"use client";

import { ArrowRight, Check, Lock, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
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

const HIGHLIGHTS = [
  "✨ AI background removal & transparent cutouts",
  "📐 Official passport, visa & card DPI resizing",
  "🗜️ Target KB compression for official portals",
  "✂️ Interactive cropping & multi-step undo history",
];

export function GuestAuthModal({
  open,
  onOpenChange,
  featureName = "Image Studio & Tools",
  description,
}: GuestAuthModalProps) {
  const router = useRouter();

  const handleRegister = useCallback(() => {
    onOpenChange(false);
    router.push("/register");
  }, [onOpenChange, router]);

  const handleLogin = useCallback(() => {
    onOpenChange(false);
    router.push("/login");
  }, [onOpenChange, router]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden border-border/80 shadow-2xl">
        <div className="relative p-6 sm:p-7 flex flex-col items-center text-center">
          {/* Subtle glow background */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />

          {/* Badge Icon */}
          <div className="relative mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-inner">
            <Lock className="size-6 text-primary" />
            <Sparkles className="size-3 text-amber-400 absolute -top-1 -right-1 animate-pulse" />
          </div>

          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Account Required
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {description ||
                `You are currently browsing as a guest. Text chat is unlimited, but using ${featureName} requires a free registered account.`}
            </DialogDescription>
          </DialogHeader>

          {/* Feature List */}
          <div className="my-5 w-full rounded-xl border border-border/60 bg-muted/30 p-3.5 text-left text-xs space-y-2 select-none">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Included with free account:
            </div>
            {HIGHLIGHTS.map((item) => (
              <div
                className="flex items-center gap-2 text-foreground/90 font-medium"
                key={item}
              >
                <Check className="size-3.5 text-emerald-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="w-full flex flex-col gap-2 pt-1">
            <Button
              className="w-full justify-center gap-2 font-semibold shadow-md cursor-pointer"
              onClick={handleRegister}
              size="default"
              type="button"
            >
              <span>Create Free Account</span>
              <ArrowRight className="size-4" />
            </Button>

            <Button
              className="w-full justify-center cursor-pointer"
              onClick={handleLogin}
              size="default"
              type="button"
              variant="outline"
            >
              Sign In to Existing Account
            </Button>

            <Button
              className="w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={handleClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Continue Chatting as Guest
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
