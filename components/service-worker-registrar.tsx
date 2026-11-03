"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production.
 *
 * A browser will not offer to install a web app without one. Registration is
 * skipped in development so a cached asset can never confuse a dev session.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const register = () => {
      navigator.serviceWorker.register(`${basePath}/sw.js`).catch(() => {
        // A failed registration costs the install prompt, not the app.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
