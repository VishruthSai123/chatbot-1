import "server-only";

import { sql } from "drizzle-orm";
import { createClient } from "redis";
import { isProductionEnvironment } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { ChatbotError } from "@/lib/errors";

const MAX_MESSAGES = 10;
const TTL_SECONDS = 60 * 60;

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!client && process.env.REDIS_URL) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", () => undefined);
    client.connect().catch(() => {
      client = null;
    });
  }
  return client;
}

/**
 * Fixed-window rate limit backed by Postgres when Redis is absent.
 *
 * Production did not have `REDIS_URL`, so the old helper returned without
 * checking anything. Postgres is already the source of truth for every other
 * counter; this keeps the abuse guard working without another paid service.
 */
export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<boolean> {
  const redis = getClient();

  if (redis?.isReady) {
    try {
      const [count] = await redis
        .multi()
        .incr(input.key)
        .expire(input.key, input.windowSeconds, "NX")
        .exec();
      return typeof count !== "number" || count <= input.limit;
    } catch {
      // Fall through to Postgres.
    }
  }

  try {
    const result = (await db.execute(sql`
      insert into "RateLimit" ("key", "windowStart", "count")
      values (${input.key}, now(), 1)
      on conflict ("key") do update set
        "count" = case
          when "RateLimit"."windowStart" < now() - (${input.windowSeconds}::int * interval '1 second')
            then 1
          else "RateLimit"."count" + 1
        end,
        "windowStart" = case
          when "RateLimit"."windowStart" < now() - (${input.windowSeconds}::int * interval '1 second')
            then now()
          else "RateLimit"."windowStart"
        end
      returning "count"
    `)) as unknown as Array<{ count: number }>;

    const count = Number(result[0]?.count ?? 0);
    return count <= input.limit;
  } catch (error) {
    // Availability beats a hard failure here: a database hiccup should not take
    // chat down. The per-account quota is still enforced separately.
    console.error("Rate limit check failed:", error);
    return true;
  }
}

export async function checkIpRateLimit(ip: string | undefined) {
  if (!isProductionEnvironment || !ip) {
    return;
  }

  const allowed = await consumeRateLimit({
    key: `ip-rate-limit:${ip}`,
    limit: MAX_MESSAGES,
    windowSeconds: TTL_SECONDS,
  });

  if (!allowed) {
    throw new ChatbotError("rate_limit:chat");
  }
}

export async function checkIpRateLimitFor(input: {
  ip: string | undefined;
  key: string;
  limit: number;
  windowSeconds?: number;
}): Promise<boolean> {
  if (!input.ip) {
    return true;
  }

  return await consumeRateLimit({
    key: `ip-rate-limit:${input.key}:${input.ip}`,
    limit: input.limit,
    windowSeconds: input.windowSeconds ?? TTL_SECONDS,
  });
}
