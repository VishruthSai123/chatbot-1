import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * Makes the app installable: a home-screen icon, a standalone window, and the
 * right theme colours for both schemes. Next serves this at `/manifest.webmanifest`
 * and links it from every page automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return {
    background_color: "#09090b",
    description:
      "Spire is an AI workbench for images, PDFs, spreadsheets, documents, audio, notebooks and research.",
    display: "standalone",
    icons: [
      {
        sizes: "192x192",
        src: `${basePath}/icons/icon-192.png`,
        type: "image/png",
      },
      {
        sizes: "512x512",
        src: `${basePath}/icons/icon-512.png`,
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: `${basePath}/icons/icon-maskable-512.png`,
        type: "image/png",
      },
    ],
    name: "Spire",
    orientation: "portrait-primary",
    scope: `${basePath}/`,
    short_name: "Spire",
    start_url: `${basePath}/`,
    theme_color: "#09090b",
  };
}
