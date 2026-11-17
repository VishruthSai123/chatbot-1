"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { type ResetPasswordState, resetPassword } from "../recovery-actions";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(
    resetPassword,
    { status: "idle" }
  );

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  useEffect(() => {
    if (state.status === "invalid_token") {
      toast({
        description: "This reset link is invalid or has expired.",
        type: "error",
      });
    } else if (state.status === "rate_limited") {
      toast({
        description: "Too many attempts. Please wait a little and try again.",
        type: "error",
      });
    } else if (state.status === "invalid_data") {
      toast({
        description: "Enter a new password and make sure both fields match.",
        type: "error",
      });
    }
  }, [state.status]);

  if (state.status === "success") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Password updated
        </h1>
        <p className="text-sm text-muted-foreground">
          Your password has been changed. Sign in with the new one.
        </p>
        <Link
          className="text-sm text-foreground underline-offset-4 hover:underline"
          href="/login"
        >
          Sign in
        </Link>
      </>
    );
  }

  if (token === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Checking your reset link...
      </p>
    );
  }

  if (!token) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="text-sm text-muted-foreground">
          This reset link is missing or incomplete. Request a new one.
        </p>
        <Link
          className="text-sm text-foreground underline-offset-4 hover:underline"
          href="/forgot-password"
        >
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <p className="text-sm text-muted-foreground">
        Use at least 6 characters. The link works once.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        <input name="token" type="hidden" value={token} />
        <div className="flex flex-col gap-2">
          <Label
            className="font-normal text-muted-foreground"
            htmlFor="password"
          >
            New password
          </Label>
          <Input
            autoComplete="new-password"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm"
            id="password"
            name="password"
            required
            type="password"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label
            className="font-normal text-muted-foreground"
            htmlFor="confirmPassword"
          >
            Confirm password
          </Label>
          <Input
            autoComplete="new-password"
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm"
            id="confirmPassword"
            name="confirmPassword"
            required
            type="password"
          />
        </div>
        <SubmitButton isSuccessful={false}>Update password</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/forgot-password"
          >
            Request a new link
          </Link>
        </p>
      </form>
    </>
  );
}
