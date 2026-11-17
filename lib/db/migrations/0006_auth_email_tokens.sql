-- Single-use email verification and password-reset tokens.
-- Only the SHA-256 hash of a token is stored.

CREATE TABLE IF NOT EXISTS "EmailToken" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "purpose" varchar(32) NOT NULL,
  "tokenHash" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "usedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailToken_tokenHash_key"
  ON "EmailToken" ("tokenHash");

CREATE INDEX IF NOT EXISTS "EmailToken_user_purpose_idx"
  ON "EmailToken" ("userId", "purpose", "createdAt");

CREATE INDEX IF NOT EXISTS "EmailToken_expires_idx"
  ON "EmailToken" ("expiresAt");
