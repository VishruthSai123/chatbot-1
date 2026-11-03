import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  description: "Next.js chatbot template using the AI SDK.",
  metadataBase: new URL("https://chat.vercel.ai"),
  title: "Next.js Chatbot Template",
};

export const viewport: Viewport = {
  maximumScale: 1,
  themeColor: [
    { color: "hsl(0 0% 100%)", media: "(prefers-color-scheme: light)" },
    { color: "hsl(240deg 10% 3.92%)", media: "(prefers-color-scheme: dark)" },
  ],
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
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
