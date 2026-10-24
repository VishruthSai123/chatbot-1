"use client";

import {
  KeyRoundIcon,
  Loader2,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Connecting a media session.
 *
 * Instagram and Facebook serve most of their videos only to a signed-in
 * visitor. This panel is where a user connects their own session, so the
 * downloader can reach their own content.
 *
 * The cookies are the user's credential: they are encrypted before they are
 * stored, they are only ever used for that user's own downloads, and they are
 * never shown again after they are saved.
 */

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

type SessionsResponse = {
  connected?: string[];
  platforms?: string[];
};

export function MediaSessionDialog({
  onOpenChange,
  open,
}: {
  onOpenChange?: (open: boolean) => void;
  open: boolean;
}) {
  const [connected, setConnected] = useState<string[]>([]);
  const [platform, setPlatform] = useState("instagram");
  const [cookies, setCookies] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/media`,
        { method: "GET" }
      );
      const data = (await response.json()) as SessionsResponse;

      if (response.ok) {
        setConnected(data.connected ?? []);
      }
    } catch {
      // A failure here only means the list cannot be shown; connecting still
      // works, and the server will say what is wrong if it does not.
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [load, open]);

  const handleConnect = useCallback(async () => {
    if (!cookies.trim()) {
      toast.error("Paste your cookies.txt first.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/media`,
        {
          body: JSON.stringify({
            action: "connect",
            cookies,
            platform,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data?.error ?? "The session could not be saved.");
        return;
      }

      setCookies("");
      setConnected((current) =>
        current.includes(platform) ? current : [...current, platform]
      );
      toast.success(
        `${PLATFORM_LABELS[platform] ?? platform} session connected.`
      );
    } catch {
      toast.error("The session could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }, [cookies, platform]);

  const handleDisconnect = useCallback(async () => {
    setIsSaving(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/media`,
        {
          body: JSON.stringify({ action: "disconnect", platform }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );

      if (!response.ok) {
        toast.error("The session could not be removed.");
        return;
      }

      setConnected((current) => current.filter((item) => item !== platform));
      toast.success(
        `${PLATFORM_LABELS[platform] ?? platform} session removed.`
      );
    } catch {
      toast.error("The session could not be removed.");
    } finally {
      setIsSaving(false);
    }
  }, [platform]);

  const isConnected = connected.includes(platform);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Media sessions</DialogTitle>
          <DialogDescription>
            Instagram and Facebook only show their videos to a signed-in
            visitor. Connect your own session to download your own content.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Which platform */}
          <div className="flex items-center gap-1.5">
            {Object.keys(PLATFORM_LABELS).map((name) => (
              <button
                className={cn(
                  "cursor-pointer rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                  platform === name
                    ? "border-foreground/40 bg-muted text-foreground"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                )}
                key={name}
                onClick={() => setPlatform(name)}
                type="button"
              >
                {PLATFORM_LABELS[name]}
                {connected.includes(name) ? (
                  <span className="ml-1.5 text-emerald-500">●</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* The cookie file */}
          <Textarea
            className="min-h-32 font-mono text-[11px]"
            onChange={(event) => setCookies(event.target.value)}
            placeholder={
              "# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\t…"
            }
            spellCheck={false}
            value={cookies}
          />

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Export your cookies as a <span className="font-mono">.txt</span>{" "}
            file in Netscape format from your browser&rsquo;s cookie extension,
            then paste them here. They are encrypted before they are stored and
            are only ever used for your own downloads.
          </p>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" />
            <span>Only you can see or use this session.</span>
          </div>
        </div>

        <DialogFooter>
          {isConnected ? (
            <Button
              disabled={isSaving}
              onClick={handleDisconnect}
              size="sm"
              variant="outline"
            >
              {isSaving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              Disconnect
            </Button>
          ) : null}

          <Button disabled={isSaving} onClick={handleConnect} size="sm">
            {isSaving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <KeyRoundIcon className="size-3.5" />
            )}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
