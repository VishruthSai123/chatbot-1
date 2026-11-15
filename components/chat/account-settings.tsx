"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";

import { deleteAccount } from "@/app/(chat)/account-actions";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WebReadySignal } from "@/components/web-ready-signal";
import { cn } from "@/lib/utils";

export function AccountSettings({
  email,
  isGuest,
}: {
  email: string;
  isGuest: boolean;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [showDeleteChats, setShowDeleteChats] = useState(false);
  const [isDeletingChats, setIsDeletingChats] = useState(false);
  const [isDeletingAccount, startDeleteAccount] = useTransition();

  const canDeleteAccount =
    confirmation === "DELETE" && (isGuest || password.length > 0);

  const handleDeleteChats = useCallback(async () => {
    setShowDeleteChats(false);
    setIsDeletingChats(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Could not delete chats.");
      }

      mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
        revalidate: false,
      });
      toast.success("All chats deleted");
      router.refresh();
    } catch {
      toast.error("Could not delete chats. Please try again.");
    } finally {
      setIsDeletingChats(false);
    }
  }, [mutate, router]);

  const handleDeleteAccount = useCallback(() => {
    if (!canDeleteAccount) {
      return;
    }

    startDeleteAccount(async () => {
      const formData = new FormData();
      formData.set("confirmation", confirmation);
      if (!isGuest) {
        formData.set("password", password);
      }

      const result = await deleteAccount(formData);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Account deleted");
      await signOut({ redirectTo: "/" });
    });
  }, [canDeleteAccount, confirmation, isGuest, password]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
      <WebReadySignal />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Account & data
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Download a copy of your data or permanently delete your account.
        </p>
      </div>

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <h2 className="text-[13px] font-medium text-foreground">
          {isGuest ? "Guest session" : "Signed in as"}
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {email || "Guest"}
        </p>
      </section>

      {isGuest ? (
        <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
          <h2 className="text-[13px] font-medium text-foreground">
            Deleting a registered account?
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            You are in a guest session. Sign in first to manage or delete your
            registered account. Everything below applies to this guest session
            only.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href="/login?next=/settings/account">Sign in</Link>
          </Button>
        </section>
      ) : null}

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <h2 className="text-[13px] font-medium text-foreground">
          Download your data
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Get a JSON copy of your chats, documents, files, tasks and usage
          history. Passwords, media cookies and Live tokens are never included.
        </p>
        <Button asChild className="mt-3" size="sm" variant="outline">
          <a download href="/api/account/export">
            Download JSON
          </a>
        </Button>
      </section>

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <h2 className="text-[13px] font-medium text-foreground">
          Delete all chats
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Removes every conversation from your account. Files in your library
          and your account itself are kept.
        </p>
        <Button
          className="mt-3"
          disabled={isDeletingChats}
          onClick={() => setShowDeleteChats(true)}
          size="sm"
          variant="outline"
        >
          {isDeletingChats ? "Deleting..." : "Delete all chats"}
        </Button>
      </section>

      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
          <ShieldAlert className="size-3.5" />
          Delete account
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Permanently deletes your account, chats, documents, generated files
          and usage records. This cannot be undone. Download your data first if
          you want a copy.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label
            className="text-[11px] font-medium text-foreground/80"
            htmlFor="delete-account-confirmation"
          >
            Type DELETE to confirm
          </label>
          <Input
            autoComplete="off"
            id="delete-account-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="DELETE"
            value={confirmation}
          />
        </div>

        {isGuest ? null : (
          <div className="mt-3 flex flex-col gap-2">
            <label
              className="text-[11px] font-medium text-foreground/80"
              htmlFor="delete-account-password"
            >
              Current password
            </label>
            <Input
              autoComplete="current-password"
              id="delete-account-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              type="password"
              value={password}
            />
          </div>
        )}

        <Button
          className={cn("mt-4", !canDeleteAccount && "opacity-60")}
          disabled={!canDeleteAccount || isDeletingAccount}
          onClick={handleDeleteAccount}
          size="sm"
          variant="destructive"
        >
          {isDeletingAccount ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Deleting...
            </>
          ) : (
            "Delete my account"
          )}
        </Button>
      </section>

      <AlertDialog onOpenChange={setShowDeleteChats} open={showDeleteChats}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every conversation from your account. It
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChats}>
              Delete all chats
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
