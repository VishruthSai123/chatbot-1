CREATE TABLE IF NOT EXISTS "RateLimit" (
  "key" text PRIMARY KEY NOT NULL,
  "windowStart" timestamptz NOT NULL DEFAULT now(),
  "count" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "RateLimit_windowStart_idx" ON "RateLimit" ("windowStart");

-- One ledger row per storage object. Without this, a retried upload can be
-- counted twice and a duplicate object can hide behind the same key.
CREATE UNIQUE INDEX IF NOT EXISTS "Artifact_storageKey_key" ON "Artifact" ("storageKey");
