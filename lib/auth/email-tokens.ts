import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { emailToken } from "@/lib/db/schema";

export type EmailTokenPurpose = "verify_email" | "reset_password";

const TOKEN_TTL_SECONDS: Record<EmailTokenPurpose, number> = {
  reset_password: 60 * 60,
  verify_email: 60 * 60 * 24,
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a single-use token and invalidates older unused tokens for the same
 * user and purpose. The raw token is returned once and is never stored.
 */
export async function createEmailToken({
  purpose,
  userId,
}: {
  purpose: EmailTokenPurpose;
  userId: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS[purpose] * 1000);

  await db.transaction(async (tx) => {
    await tx
      .delete(emailToken)
      .where(
        and(eq(emailToken.userId, userId), eq(emailToken.purpose, purpose))
      );

    await tx.insert(emailToken).values({
      expiresAt,
      purpose,
      tokenHash: hashToken(token),
      userId,
    });
  });

  return token;
}

/**
 * Marks a token used and returns its owner. The update is the check: two
 * concurrent requests cannot both consume the same token.
 */
export async function consumeEmailToken({
  purpose,
  token,
}: {
  purpose: EmailTokenPurpose;
  token: string;
}): Promise<string | null> {
  const normalized = token.trim();

  if (!TOKEN_PATTERN.test(normalized)) {
    return null;
  }

  const [row] = await db
    .update(emailToken)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailToken.tokenHash, hashToken(normalized)),
        eq(emailToken.purpose, purpose),
        isNull(emailToken.usedAt),
        gt(emailToken.expiresAt, new Date())
      )
    )
    .returning({ userId: emailToken.userId });

  return row?.userId ?? null;
}

export async function invalidateEmailTokens({
  purpose,
  userId,
}: {
  purpose: EmailTokenPurpose;
  userId: string;
}) {
  await db
    .delete(emailToken)
    .where(and(eq(emailToken.userId, userId), eq(emailToken.purpose, purpose)));
}
