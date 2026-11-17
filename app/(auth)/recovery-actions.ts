"use server";

import { createHash } from "node:crypto";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  consumeEmailToken,
  createEmailToken,
  invalidateEmailTokens,
} from "@/lib/auth/email-tokens";
import { authEmailOrigin } from "@/lib/auth/origin";
import { sendVerificationForUser } from "@/lib/auth/verification";
import { getUser, getUserById, updateUserPassword } from "@/lib/db/queries";
import { sendPasswordResetEmail } from "@/lib/email/auth-emails";
import { checkIpRateLimitFor, consumeRateLimit } from "@/lib/ratelimit";

const requestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
});

const resetSchema = z
  .object({
    confirmPassword: z.string().min(6).max(72),
    password: z.string().min(6).max(72),
    token: z.string().min(20).max(256),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type RequestResetState = {
  status: "idle" | "sent" | "invalid_data" | "rate_limited";
};

export type ResetPasswordState = {
  status:
    | "idle"
    | "success"
    | "invalid_token"
    | "invalid_data"
    | "rate_limited";
};

async function requestIp() {
  const headerStore = await headers();
  return headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
}

function emailLimitKey(email: string) {
  return `auth-reset-email:${createHash("sha256").update(email).digest("hex")}`;
}

/**
 * Starts a password reset.
 *
 * The response is identical whether or not the address belongs to an account,
 * so this cannot be used to enumerate users. Delivery failures are logged
 * without the address or token.
 */
export async function requestPasswordReset(
  _: RequestResetState,
  formData: FormData
): Promise<RequestResetState> {
  const ipAllowed = await checkIpRateLimitFor({
    ip: await requestIp(),
    key: "password-reset-request",
    limit: 10,
    windowSeconds: 60 * 60,
  });

  if (!ipAllowed) {
    return { status: "rate_limited" };
  }

  const parsed = requestSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { status: "invalid_data" };
  }

  const emailAllowed = await consumeRateLimit({
    key: emailLimitKey(parsed.data.email),
    limit: 3,
    windowSeconds: 60 * 60,
  });

  if (!emailAllowed) {
    return { status: "sent" };
  }

  try {
    const [account] = await getUser(parsed.data.email);

    if (account && !account.isAnonymous && account.password) {
      const [token, origin] = await Promise.all([
        createEmailToken({ purpose: "reset_password", userId: account.id }),
        authEmailOrigin(),
      ]);

      await sendPasswordResetEmail({
        origin,
        to: account.email,
        token,
      });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        errorClass: error instanceof Error ? error.name : "UnknownError",
        event: "password_reset_request_failed",
      })
    );
  }

  return { status: "sent" };
}

export async function resetPassword(
  _: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const ipAllowed = await checkIpRateLimitFor({
    ip: await requestIp(),
    key: "password-reset-submit",
    limit: 10,
    windowSeconds: 60 * 60,
  });

  if (!ipAllowed) {
    return { status: "rate_limited" };
  }

  const parsed = resetSchema.safeParse({
    confirmPassword: formData.get("confirmPassword"),
    password: formData.get("password"),
    token: formData.get("token"),
  });

  if (!parsed.success) {
    return { status: "invalid_data" };
  }

  try {
    const userId = await consumeEmailToken({
      purpose: "reset_password",
      token: parsed.data.token,
    });

    if (!userId) {
      return { status: "invalid_token" };
    }

    await updateUserPassword(userId, parsed.data.password);
    await invalidateEmailTokens({ purpose: "reset_password", userId });

    return { status: "success" };
  } catch (error) {
    console.error(
      JSON.stringify({
        errorClass: error instanceof Error ? error.name : "UnknownError",
        event: "password_reset_failed",
      })
    );
    return { status: "invalid_token" };
  }
}

export type ResendVerificationState = {
  status: "idle" | "sent" | "already_verified" | "rate_limited" | "failed";
};

export async function resendVerificationEmail(): Promise<ResendVerificationState> {
  const session = await auth();

  if (!session?.user?.id || session.user.type === "guest") {
    return { status: "failed" };
  }

  const ipAllowed = await checkIpRateLimitFor({
    ip: await requestIp(),
    key: "email-verification-resend",
    limit: 5,
    windowSeconds: 60 * 60,
  });

  if (!ipAllowed) {
    return { status: "rate_limited" };
  }

  const account = await getUserById(session.user.id);

  if (!account || account.isAnonymous) {
    return { status: "failed" };
  }

  if (account.emailVerified) {
    return { status: "already_verified" };
  }

  const userAllowed = await consumeRateLimit({
    key: `email-verification-user:${account.id}`,
    limit: 3,
    windowSeconds: 60 * 60,
  });

  if (!userAllowed) {
    return { status: "rate_limited" };
  }

  try {
    const delivery = await sendVerificationForUser({
      email: account.email,
      userId: account.id,
    });

    if (!delivery.delivered && process.env.NODE_ENV === "production") {
      return { status: "failed" };
    }

    return { status: "sent" };
  } catch (error) {
    console.error(
      JSON.stringify({
        errorClass: error instanceof Error ? error.name : "UnknownError",
        event: "email_verification_send_failed",
      })
    );
    return { status: "failed" };
  }
}
