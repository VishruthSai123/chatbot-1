CREATE TABLE "Entitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"orgId" uuid,
	"plan" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"trialStart" timestamp with time zone,
	"trialEnd" timestamp with time zone,
	"periodStart" timestamp with time zone NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "LiveSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"reservationId" uuid NOT NULL,
	"tokenName" varchar(256) NOT NULL,
	"model" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'reserved' NOT NULL,
	"reservedSeconds" integer NOT NULL,
	"actualSeconds" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp with time zone,
	"endedAt" timestamp with time zone,
	"expireAt" timestamp with time zone NOT NULL,
	"costUsd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PriceBook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" varchar(64) NOT NULL,
	"lane" varchar(16) NOT NULL,
	"inputPer1M" numeric(10, 4) NOT NULL,
	"cachedPer1M" numeric(10, 4) DEFAULT '0' NOT NULL,
	"outputPer1M" numeric(10, 4) NOT NULL,
	"liveAudioInPerMin" numeric(10, 4),
	"liveAudioOutPerMin" numeric(10, 4),
	"liveVideoInPerMin" numeric(10, 4),
	"effectiveFrom" timestamp with time zone NOT NULL,
	"effectiveTo" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "UsageCounter" (
	"subjectType" varchar(8) NOT NULL,
	"subjectId" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"period" varchar(8) NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"used" numeric(12, 3) DEFAULT '0' NOT NULL,
	"reserved" numeric(12, 3) DEFAULT '0' NOT NULL,
	"limitValue" numeric(12, 3) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UsageCounter_subjectType_subjectId_kind_period_periodStart_pk" PRIMARY KEY("subjectType","subjectId","kind","period","periodStart")
);
--> statement-breakpoint
CREATE TABLE "UsageEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"orgId" uuid,
	"kind" varchar(32) NOT NULL,
	"model" varchar(64),
	"lane" varchar(16),
	"inputTokens" integer DEFAULT 0 NOT NULL,
	"cachedTokens" integer DEFAULT 0 NOT NULL,
	"outputTokens" integer DEFAULT 0 NOT NULL,
	"liveSeconds" integer DEFAULT 0 NOT NULL,
	"toolOps" integer DEFAULT 0 NOT NULL,
	"bytesIn" bigint DEFAULT 0 NOT NULL,
	"bytesOut" bigint DEFAULT 0 NOT NULL,
	"costUsd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"idempotencyKey" varchar(128),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UsageReservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subjectType" varchar(8) NOT NULL,
	"subjectId" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"period" varchar(8) NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"amount" numeric(12, 3) NOT NULL,
	"status" varchar(16) DEFAULT 'held' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"idempotencyKey" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Entitlement_user_period_idx" ON "Entitlement" USING btree ("userId","periodStart");--> statement-breakpoint
CREATE INDEX "LiveSession_user_status_idx" ON "LiveSession" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "LiveSession_expire_idx" ON "LiveSession" USING btree ("status","expireAt");--> statement-breakpoint
CREATE UNIQUE INDEX "LiveSession_reservation_idx" ON "LiveSession" USING btree ("reservationId");--> statement-breakpoint
CREATE UNIQUE INDEX "PriceBook_model_lane_from_idx" ON "PriceBook" USING btree ("model","lane","effectiveFrom");--> statement-breakpoint
CREATE INDEX "UsageEvent_user_created_idx" ON "UsageEvent" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "UsageEvent_org_created_idx" ON "UsageEvent" USING btree ("orgId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UsageEvent_idem_idx" ON "UsageEvent" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "UsageReservation_status_idx" ON "UsageReservation" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UsageReservation_idem_idx" ON "UsageReservation" USING btree ("idempotencyKey");
