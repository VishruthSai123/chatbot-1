import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

const basePath = process.env.IS_DEMO === "1" ? "/demo" : "";

const nextConfig: NextConfig = {
  ...(basePath
    ? {
        assetPrefix: "/demo-assets",
        basePath,
        redirects: async () => [
          {
            basePath: false,
            destination: basePath,
            permanent: false,
            source: "/",
          },
        ],
      }
    : {}),
  cacheComponents: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    appNewScrollHandler: true,
    cachedNavigations: true,
    inlineCss: true,
    prefetchInlining: true,
    turbopackFileSystemCacheForDev: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        hostname: "*.public.blob.vercel-storage.com",
        protocol: "https",
      },
      {
        hostname: "*.supabase.co",
        protocol: "https",
      },
      {
        hostname: "dexzwnsukzxyguuqseax.supabase.co",
        protocol: "https",
      },
    ],
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
    incomingRequests: false,
  },
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v3/win32/**/*",
      "./node_modules/@img/sharp-win32-x64/**/*",
      "./node_modules/@img/sharp-darwin-*/**/*",
      "./node_modules/@playwright/**/*",
      "./node_modules/@swc/core-win32-x64-msvc/**/*",
      "./node_modules/@esbuild/win32-x64/**/*",
    ],
  },
  outputFileTracingIncludes: {
    "/api/tools/image": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@imgly/background-removal-node/**/*",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/**/*",
    ],
  },
  poweredByHeader: false,
  reactCompiler: true,
  rewrites: async () => [
    { destination: "/api/data/document", source: "/api/document" },
    { destination: "/api/data/history", source: "/api/history" },
    { destination: "/api/data/messages", source: "/api/messages" },
    { destination: "/api/data/vote", source: "/api/vote" },
  ],
  serverExternalPackages: [
    "sharp",
    "@imgly/background-removal-node",
    "onnxruntime-node",
  ],
};

export default withBotId(nextConfig);
