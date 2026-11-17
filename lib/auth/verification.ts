import "server-only";

import { createEmailToken } from "@/lib/auth/email-tokens";
import { authEmailOrigin } from "@/lib/auth/origin";
import { sendVerificationEmail } from "@/lib/email/auth-emails";

/** Creates a fresh token and sends the verification link. */
export async function sendVerificationForUser({
  email,
  origin,
  userId,
}: {
  email: string;
  origin?: string;
  userId: string;
}) {
  const [token, resolvedOrigin] = await Promise.all([
    createEmailToken({ purpose: "verify_email", userId }),
    origin ? Promise.resolve(origin) : authEmailOrigin(),
  ]);

  return sendVerificationEmail({ origin: resolvedOrigin, to: email, token });
}
