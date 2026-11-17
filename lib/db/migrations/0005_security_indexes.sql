-- Integrity and hot-path indexes found by the production readiness audit.
-- The live data was checked first: no duplicate or non-lowercase emails.

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_unique"
  ON "User" (lower(email));

CREATE INDEX IF NOT EXISTS "Chat_user_created_idx"
  ON "Chat" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_chat_created_idx"
  ON "Message_v2" ("chatId", "createdAt");

CREATE INDEX IF NOT EXISTS "Document_user_created_idx"
  ON "Document" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Artifact_user_created_idx"
  ON "Artifact" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Artifact_chat_idx"
  ON "Artifact" ("chatId");

CREATE INDEX IF NOT EXISTS "MediaSession_user_idx"
  ON "MediaSession" ("userId");
