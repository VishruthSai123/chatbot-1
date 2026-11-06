"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { useAuthReturnHref } from "@/hooks/use-auth-return";

export function AuthBackLink() {
  const returnHref = useAuthReturnHref();

  return (
    <Link
      className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      href={returnHref}
    >
      <ArrowLeftIcon className="size-3.5" />
      Back
    </Link>
  );
}
