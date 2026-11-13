import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * The database pool.
 *
 * The connection string points at Supabase's **session** pooler (port 5432),
 * which allows fifteen sessions in total — not per client, not per query. The
 * default pool size of ten connections per instance therefore means that two
 * serverless instances can exhaust the pooler on their own, and the symptom is
 * `max clients reached in session mode - pool_size: 15` on every query.
 *
 * Three settings fix that:
 *
 * - `max: 3` — a request handler never needs ten concurrent queries, and three
 *   instances can share the pooler's fifteen slots comfortably.
 * - `idle_timeout` — idle connections are closed, so a burst of traffic does not
 *   hold sessions open after the work is done.
 * - `connect_timeout` — a pool that cannot be reached fails in seconds with a
 *   clear error, rather than hanging until the request times out.
 *
 * The better fix, if the deployment can be changed, is the **transaction**
 * pooler (port 6543): it pools per transaction rather than per session, so it has
 * no session limit at all. `prepare: false` is already set for exactly that
 * reason.
 */
const connectionString =
  process.env.POSTGRES_TRANSACTION_URL ?? process.env.POSTGRES_URL ?? "";

const client = postgres(connectionString, {
  connect_timeout: 10,
  idle_timeout: 30,
  max: 3,
  prepare: false,
  ssl:
    process.env.NODE_ENV === "production" ||
    connectionString.includes("supabase.com")
      ? "require"
      : undefined,
});

export const db = drizzle(client);
