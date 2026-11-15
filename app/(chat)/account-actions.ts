"use server";

import { compare } from "bcrypt-ts";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { deleteUserAccount } from "@/lib/account/deletion";
import { guestRegex } from "@/lib/constants";
import { getUserById } from "@/lib/db/queries";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

const deleteAccountSchema = z.object({
  confirmation: z.string().trim(),
  password: z.string().optional(),
});

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes the signed-in account after re-checking the password.
 *
 * The client signs out after this returns. The action deliberately does not
 * redirect itself, so a failed password check can keep the dialog open.
 */
export async function deleteAccount(
  formData: FormData
): Promise<DeleteAccountResult> {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return { error: "You need to be signed in.", ok: false };
    }

    const parsed = deleteAccountSchema.safeParse({
      confirmation: formData.get("confirmation"),
      password: formData.get("password") ?? undefined,
    });

    if (!parsed.success || parsed.data.confirmation !== "DELETE") {
      return { error: "Type DELETE to confirm.", ok: false };
    }

    const headerStore = await headers();
    const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
    const allowed = await checkIpRateLimitFor({
      ip,
      key: "account-delete",
      limit: 5,
      windowSeconds: 60 * 60,
    });

    if (!allowed) {
      return { error: "Too many attempts. Try again later.", ok: false };
    }

    const account = await getUserById(userId);

    if (!account) {
      return { error: "This account no longer exists.", ok: false };
    }

    const isGuest =
      session.user.type === "guest" || guestRegex.test(account.email);

    if (!isGuest) {
      const password = parsed.data.password ?? "";

      if (!account.password || !password) {
        return { error: "Enter your current password.", ok: false };
      }

      const passwordsMatch = await compare(password, account.password);

      if (!passwordsMatch) {
        return { error: "That password is not correct.", ok: false };
      }
    }

    await deleteUserAccount(userId);

    return { ok: true };
  } catch (error) {
    console.error("Account deletion failed:", error);

    if (
      error instanceof Error &&
      error.message.startsWith("Some files could not be deleted")
    ) {
      return { error: error.message, ok: false };
    }

    return {
      error: "We could not delete your account. Please try again.",
      ok: false,
    };
  }
}
