"use client";

import { LockIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * What a guest sees where a tool would have run.
 *
 * A bare "sign in to use this" error is a dead end: it tells someone what they
 * cannot do and gives them nowhere to go. This is the same message with the two
 * actions that resolve it, and it remembers where they were so signing up
 * returns them to the conversation rather than to a blank home screen.
 */
export function AuthRequiredNotice({
  description,
  feature,
}: {
  description?: string;
  /** What they tried to use, e.g. "PDF tools". */
  feature?: string;
}) {
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");

  return (
    <div className="flex w-full max-w-[440px] flex-col gap-2.5 rounded-xl border border-border/70 bg-card/60 p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
          <LockIcon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">
            {feature ? `Sign up to use ${feature}` : "Sign up to use this tool"}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {description ??
              "Chatting is free. Tools need a free account so your files are saved and you can come back to them."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
          href={`/register?next=${next}`}
        >
          Create free account
        </Link>
        <Link
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          href={`/login?next=${next}`}
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

/** The family a tool belongs to, for the notice's title. */
export function featureForTool(type: string): string {
  const name = type.replace(/^tool-/, "");

  if (name.startsWith("image")) {
    return "image tools";
  }
  if (name.startsWith("pdf")) {
    return "PDF tools";
  }
  if (name.startsWith("sheet")) {
    return "spreadsheet tools";
  }
  if (name.startsWith("doc")) {
    return "document tools";
  }
  if (name.startsWith("audio")) {
    return "the Audio Studio";
  }
  if (name.startsWith("notebook")) {
    return "notebooks";
  }
  if (name.startsWith("slides")) {
    return "presentations";
  }
  if (name === "downloadMedia") {
    return "downloads";
  }
  if (name === "webSearch" || name === "readUrl" || name === "research") {
    return "web search";
  }

  return "this tool";
}
