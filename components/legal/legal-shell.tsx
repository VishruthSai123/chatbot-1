import Link from "next/link";

import { SpireMark, SpireWordmark } from "@/components/brand/spire-mark";
import { LegalLinks } from "./legal-links";

export function LegalShell({
  children,
  title,
  updated,
}: {
  children: React.ReactNode;
  title: string;
  updated: string;
}) {
  return (
    <div className="legal-scroll h-dvh overflow-y-auto overscroll-contain bg-background text-foreground">
      <div className="flex min-h-full flex-col">
        <header className="border-border/50 border-b">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4">
            <Link className="flex items-center gap-2" href="/">
              <SpireMark className="size-5" />
              <SpireWordmark className="h-4" />
            </Link>
            <nav className="flex items-center gap-4 text-muted-foreground text-xs">
              <Link className="hover:text-foreground" href="/privacy">
                Privacy
              </Link>
              <Link className="hover:text-foreground" href="/terms">
                Terms
              </Link>
              <Link className="hover:text-foreground" href="/legal">
                Legal
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
          <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
          <p className="mt-2 text-muted-foreground text-xs">
            Last updated: {updated}
          </p>
          <article className="prose prose-neutral dark:prose-invert mt-8 max-w-none">
            {children}
          </article>
        </main>

        <footer className="border-border/50 border-t">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              © 2026 Superior. Spire is an independent product.
            </p>
            <LegalLinks />
          </div>
        </footer>
      </div>
    </div>
  );
}
