CREATE TABLE IF NOT EXISTS "MediaSession" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "platform" varchar(32) NOT NULL,
  "cookies" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaSession_userId_platform_idx"
  ON "MediaSession" ("userId", "platform");
