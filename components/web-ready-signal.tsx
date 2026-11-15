"use client";

import { useEffect } from "react";

type SpireAndroidBridge = {
  onWebReady?: () => void;
};

/**
 * Tells the Android WebView when React is hydrated and the page is safe to use.
 *
 * The native shell keeps its skeleton over the WebView until this fires. Without
 * it, a tap on Send during hydration submits the plain HTML form and reloads
 * the whole page.
 */
export function WebReadySignal() {
  useEffect(() => {
    document.documentElement.dataset.spireReady = "true";

    const bridge = (
      window as typeof window & { SpireAndroid?: SpireAndroidBridge }
    ).SpireAndroid;
    bridge?.onWebReady?.();

    return () => {
      delete document.documentElement.dataset.spireReady;
    };
  }, []);

  return null;
}
