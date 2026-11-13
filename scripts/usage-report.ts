import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is not defined");
  process.exit(1);
}

const days = Math.max(1, Math.min(90, Number(process.argv[2] ?? 7) || 7));
const sql = postgres(connectionString, { max: 1 });

async function main() {
  try {
    const rows = await sql`
    select
      date_trunc('day', "createdAt")::date as day,
      kind,
      coalesce(model, '-') as model,
      count(*)::int as events,
      coalesce(sum("inputTokens"), 0)::int as input_tokens,
      coalesce(sum("cachedTokens"), 0)::int as cached_tokens,
      coalesce(sum("outputTokens"), 0)::int as output_tokens,
      coalesce(sum("liveSeconds"), 0)::int as live_seconds,
      round(coalesce(sum("costUsd"), 0), 4) as cost_usd
    from "UsageEvent"
    where "createdAt" >= now() - ${days} * interval '1 day'
    group by 1, 2, 3
    order by 1 desc, 9 desc
  `;

    console.table(rows);

    const [totals] = await sql`
    select
      count(*)::int as events,
      round(coalesce(sum("costUsd"), 0), 4) as cost_usd,
      count(distinct "userId")::int as users
    from "UsageEvent"
    where "createdAt" >= now() - ${days} * interval '1 day'
  `;

    const topUsers = await sql`
    select
      u.email,
      coalesce(ent.plan, 'free') as plan,
      count(*)::int as events,
      round(coalesce(sum(ue."costUsd"), 0), 4) as cost_usd
    from "UsageEvent" ue
    join "User" u on u.id = ue."userId"
    left join lateral (
      select plan
      from "Entitlement" e
      where e."userId" = ue."userId"
        and now() >= e."periodStart"
        and now() < e."periodEnd"
      order by e."periodStart" desc
      limit 1
    ) ent on true
    where ue."createdAt" >= now() - ${days} * interval '1 day'
    group by u.email, ent.plan
    order by cost_usd desc
    limit 10
  `;

    const plans = await sql`
    select plan, count(*)::int as users
    from "Entitlement"
    where now() >= "periodStart" and now() < "periodEnd"
    group by plan
    order by users desc
  `;

    console.log(`Last ${days} days:`, totals);
    console.log("Top users by cost:");
    console.table(topUsers);
    console.log("Active plans:");
    console.table(plans);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
