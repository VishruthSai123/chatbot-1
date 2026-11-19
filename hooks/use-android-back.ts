"use client";

import { useEffect, useRef } from "react";

/**
 * Lets the Android host close a web overlay before navigating WebView history.
 *
 * The native side only consumes back while something is open; the flag is
 * cleared on unmount and whenever `consumes` becomes false.
 */
export function useAndroidBack(consumes: boolean, handler: () => boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    window.__spireHandleBack = () => handlerRef.current();

    return () => {
      window.__spireHandleBack = undefined;
      window.SpireAndroid?.setBackConsumes?.(false);
    };
  }, []);

  useEffect(() => {
    window.SpireAndroid?.setBackConsumes?.(consumes);
  }, [consumes]);
}
