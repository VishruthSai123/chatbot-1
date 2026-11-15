import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Spire",
  },
  applicationName: "Spire",
  description:
    "Spire is an AI workbench for images, PDFs, spreadsheets, documents, audio, notebooks and research.",
  icons: {
    apple: `${basePath}/icons/apple-touch-icon.png`,
    icon: `${basePath}/icons/icon-192.png`,
  },
  metadataBase: new URL("https://chatbot-1-beige.vercel.app"),
  title: "Spire",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: [
    { color: "hsl(0 0% 100%)", media: "(prefers-color-scheme: light)" },
    { color: "hsl(240deg 10% 3.92%)", media: "(prefers-color-scheme: dark)" },
  ],
  // Without an explicit device width, Android WebView lays the app out at the
  // desktop ~980px width and scales it down. That turns the mobile bottom sheet
  // into the desktop sidebar, clips its header and leaves the page unscrollable.
  width: "device-width",
};

/**
 * One family for the whole app.
 *
 * The design is sans-only: `--font-mono` is pointed at this same family in
 * `globals.css`, so a stray `font-mono` class cannot introduce a second face.
 */
const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} font-sans`}
      lang="en"
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        <Script
          src={`${basePath}/embed-boot.js`}
          strategy="beforeInteractive"
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <SessionProvider
            basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
          >
            <TooltipProvider>{children}</TooltipProvider>
            <ServiceWorkerRegistrar />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
