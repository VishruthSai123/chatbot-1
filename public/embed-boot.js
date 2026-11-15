(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "android") {
      window.sessionStorage.setItem("spire-embed-android", "1");
    }
    if (window.sessionStorage.getItem("spire-embed-android") === "1") {
      document.documentElement.dataset.embed = "android";
    }
  } catch {
    // Private mode or a blocked storage API: the React effect retries later.
  }
})();
