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
  // `onnxruntime-node` dlopen()s a native shared library that no JavaScript
  // `require` mentions (libonnxruntime.so.1.17.0 / onnxruntime.dll), and the
  // background-removal model is a set of content-addressed ONNX chunks. Neither is
  // visible to static tracing, so the deployed function would crash with
  // "libonnxruntime.so.1.17.0: cannot open shared object file". These globs copy
  // them into the two functions that can run image models.
  //
  // The tool key is a glob rather than the literal `/api/tools/[family]`: square
  // brackets are a character class in the matcher, so the literal path would match
  // nothing and the function would deploy without the shared library.
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/.pnpm/@imgly+background-removal-node@*/node_modules/@imgly/background-removal-node/dist/**",
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/linux/**",
    ],
    "/api/tools/**": [
      "./node_modules/.pnpm/@imgly+background-removal-node@*/node_modules/@imgly/background-removal-node/dist/**",
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/linux/**",
    ],
  },
  poweredByHeader: false,
  reactCompiler: true,
  serverExternalPackages: [
    "sharp",
    "@img/sharp-libvips-linux-x64",
    "@img/sharp-linux-x64",
    "@imgly/background-removal-node",
    "onnxruntime-node",
  ],
};

export default withBotId(nextConfig);
