"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type RequestResetState,
  requestPasswordReset,
} from "../recovery-actions";

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState<RequestResetState, FormData>(
    requestPasswordReset,
    { status: "idle" }
  );

  useEffect(() => {
    if (state.status === "rate_limited") {
      toast({
        description: "Too many requests. Please wait a little and try again.",
        type: "error",
      });
    } else if (state.status === "invalid_data") {
      toast({ description: "Enter a valid email address.", type: "error" });
    }
  }, [state.status]);

  if (state.status === "sent") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your inbox
        </h1>
        <p className="text-sm text-muted-foreground">
          If that address has a Spire account, a reset link is on its way. The
          link expires in one hour.
        </p>
        <Link
          className="text-sm text-foreground underline-offset-4 hover:underline"
          href="/login"
        >
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="text-sm text-muted-foreground">
        Enter your email and we will send a one-time reset link.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label className="font-normal text-muted-foreground" htmlFor="email">
            Email
          </Label>
          <Input
            autoComplete="email"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm"
            id="email"
            name="email"
            placeholder="you@someo.ne"
            required
            type="email"
          />
        </div>
        <SubmitButton isSuccessful={false}>Send reset link</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Remembered it? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </form>
    </>
  );
}
