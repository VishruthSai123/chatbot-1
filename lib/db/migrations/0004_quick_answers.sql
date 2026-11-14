CREATE TABLE IF NOT EXISTS "QuickAnswerEvent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "installId" uuid NOT NULL,
  "ipHash" text,
  model varchar(64),
  "inputTokens" integer NOT NULL DEFAULT 0,
  "outputTokens" integer NOT NULL DEFAULT 0,
  "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "QuickAnswerEvent_install_created_idx"
  ON "QuickAnswerEvent" ("installId", "createdAt");

CREATE INDEX IF NOT EXISTS "QuickAnswerEvent_created_idx"
  ON "QuickAnswerEvent" ("createdAt");
