/**
 * Keeps the Android WebView's embed mode across client-side URL updates.
 *
 * The native shell hides its own chrome and relies on `?embed=android` to tell
 * the web app to render the phone layout. `history.pushState` calls used to
 * drop that query, so a reload after sending a message rendered the web header
 * and sidebar inside the native shell.
 */
const EMBED_STORAGE_KEY = "spire-embed-android";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function rememberAndroidEmbed(): void {
  if (!hasWindow()) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") === "android") {
    window.sessionStorage.setItem(EMBED_STORAGE_KEY, "1");
  }
}

export function isAndroidEmbed(): boolean {
  if (!hasWindow()) {
    return false;
  }

  if (new URLSearchParams(window.location.search).get("embed") === "android") {
    return true;
  }

  return window.sessionStorage.getItem(EMBED_STORAGE_KEY) === "1";
}

/** Appends the embed marker only when this tab started in the Android shell. */
export function withAndroidEmbed(path: string): string {
  if (!isAndroidEmbed()) {
    return path;
  }

  const url = new URL(path, "https://spire.local");

  if (!url.searchParams.has("embed")) {
    url.searchParams.set("embed", "android");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
