import { SpireMark, SpireWordmark } from "@/components/brand/spire-mark";
import { AuthBackLink } from "@/components/chat/auth-back-link";
import { Preview } from "@/components/chat/preview";
import { WebReadySignal } from "@/components/web-ready-signal";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-screen flex-col bg-sidebar xl:flex-row">
      <WebReadySignal />
      <div className="flex min-h-dvh w-full flex-col overflow-y-auto bg-background p-6 sm:p-8 md:p-16 xl:h-dvh xl:w-[600px] xl:shrink-0 xl:rounded-r-2xl xl:border-r xl:border-border/40">
        <AuthBackLink />
        <div className="mx-auto my-auto flex w-full max-w-md flex-col gap-10 py-4">
          <div className="flex flex-col gap-2">
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SpireMark className="size-4" />
            </div>
            {children}
          </div>
        </div>
      </div>

      <div className="hidden flex-1 flex-col overflow-hidden pl-12 xl:flex xl:h-dvh">
        <div className="flex items-center gap-2 pt-8 text-[13px] text-muted-foreground/50">
          <SpireMark className="size-4 text-muted-foreground" />
          <SpireWordmark className="h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 pt-4">
          <Preview />
        </div>
      </div>
    </div>
  );
}
