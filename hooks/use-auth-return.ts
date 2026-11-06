"use client";

import { useEffect, useState } from "react";

import { safeNextPath } from "@/lib/auth/next";

/**
 * Where the auth pages should return to.
 *
 * Two things travel through a sign-in:
 *
 * - `next`, set by anything that asked a guest to sign up, so they land back in
 *   the conversation they were in rather than on a blank home screen;
 * - `embed=android`, which the Android shell uses to keep its embed layout.
 *
 * The result is computed after mount because it comes from the address bar,
 * which does not exist during a server render.
 */
export function useAuthReturnHref() {
  const [href, setHref] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNextPath(params.get("next"));
    const embed = params.get("embed") === "android";

    if (!embed) {
      setHref(next);
      return;
    }

    const separator = next.includes("?") ? "&" : "?";

    setHref(`${next}${separator}embed=android`);
  }, []);

  return href;
}
