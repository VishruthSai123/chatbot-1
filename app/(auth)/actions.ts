"use server";

import { z } from "zod";

import {
  claimGuestWork,
  createUser,
  getUser,
  upgradeGuestUser,
} from "@/lib/db/queries";

import { auth, signIn } from "./auth";

const authFormSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    /*
     * Read the guest session before signing in: `signIn` writes the account's
     * cookie, so afterwards there is no reliable way to tell that this request
     * started as a guest.
     */
    const guestSession = await auth();
    const [account] = await getUser(validatedData.email);

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    /**
     * A guest who signs in to an existing account takes their work with them.
     *
     * Registration upgrades the guest row, so there is nothing to move. Here
     * the cookie is replaced by the account's, and any conversation the visitor
     * had as a guest would otherwise be left on a row they can no longer
     * reach. Only run this after `signIn` succeeds, so a wrong password cannot
     * hand someone else's guest work to the attempted account.
     */
    const wasGuest =
      guestSession?.user?.type === "guest" ||
      /^guest-\d+$/.test(guestSession?.user?.email ?? "");

    if (wasGuest && guestSession?.user?.id && account) {
      await claimGuestWork({
        fromUserId: guestSession.user.id,
        toUserId: account.id,
      });
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const [existing] = await getUser(validatedData.email);

    if (existing) {
      return { status: "user_exists" } as RegisterActionState;
    }

    /**
     * A guest who signs up keeps their work.
     *
     * The account is the same row, so the conversation they were in — and every
     * file they made — is still theirs after the upgrade. Creating a second
     * user would leave all of it behind on an anonymous account.
     */
    const session = await auth();
    const isGuest =
      session?.user?.type === "guest" ||
      /^guest-\d+$/.test(session?.user?.email ?? "");

    if (isGuest && session?.user?.id) {
      await upgradeGuestUser({
        email: validatedData.email,
        id: session.user.id,
        password: validatedData.password,
      });
    } else {
      await createUser(validatedData.email, validatedData.password);
    }

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
