"use client";

import { useSession } from "next-auth/react";
import { guestRegex } from "@/lib/constants";

export function useIsGuest(): { isGuest: boolean; isLoading: boolean } {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return { isGuest: false, isLoading: true };
  }

  const isGuest =
    !session?.user ||
    session.user.type === "guest" ||
    guestRegex.test(session.user.email ?? "");

  return { isGuest, isLoading: false };
}
