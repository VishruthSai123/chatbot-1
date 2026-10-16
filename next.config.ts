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
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/@imgly/**/*",
      "./node_modules/onnxruntime-node/**/*",
    ],
    "/api/tools/image": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/@imgly/**/*",
      "./node_modules/onnxruntime-node/**/*",
    ],
  },
  poweredByHeader: false,
  reactCompiler: true,
  serverExternalPackages: [
    "sharp",
    "@imgly/background-removal-node",
    "onnxruntime-node",
  ],
};

export default withBotId(nextConfig);
