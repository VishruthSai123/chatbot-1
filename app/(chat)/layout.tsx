import { cookies, headers } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShellGate } from "@/components/chat/chat-shell-gate";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { auth } from "../(auth)/auth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <SidebarShell>{children}</SidebarShell>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore, headerStore] = await Promise.all([
    auth(),
    cookies(),
    headers(),
  ]);
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";
  /*
   * The Android shell is always immersive. Detect it from the user-agent
   * marker instead of the URL so server rendering never paints the sidebar or
   * header first. Desktops and mobile browsers keep the normal shell.
   */
  const isAndroidShell = (headerStore.get("user-agent") ?? "").includes(
    "SpireAndroid/1.0"
  );
  // Native sets this cookie only while SPIRE_IMMERSIVE is enabled, so the old
  // header/sidebar layout remains the rollback path.
  const isAndroidImmersive =
    isAndroidShell && cookieStore.get("spire_immersive")?.value === "1";

  const main = (
    <>
      <Toaster
        position="top-center"
        theme="system"
        toastOptions={{
          className:
            "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
        }}
      />
      <Suspense fallback={<div className="flex h-dvh" />}>
        <ActiveChatProvider>
          <ChatShellGate />
        </ActiveChatProvider>
      </Suspense>
      {children}
    </>
  );

  if (isAndroidImmersive) {
    return (
      <div
        className="flex min-h-dvh flex-col overflow-hidden bg-sidebar"
        data-spire-chat-shell="android"
      >
        {main}
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={session?.user} />
      <SidebarInset>{main}</SidebarInset>
    </SidebarProvider>
  );
}
