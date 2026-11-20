import Link from "next/link";

import { cn } from "@/lib/utils";

export function LegalLinks({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs",
        className
      )}
    >
      <Link className="hover:text-foreground hover:underline" href="/privacy">
        Privacy Policy
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/terms">
        Terms of Service
      </Link>
      <Link className="hover:text-foreground hover:underline" href="/legal">
        Legal &amp; licenses
      </Link>
    </div>
  );
}
