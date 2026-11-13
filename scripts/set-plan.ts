import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const [email, planArg, daysArg] = process.argv.slice(2);
const plans = new Set(["free", "go", "plus", "pro", "business", "daypass"]);

if (!(email && planArg && plans.has(planArg))) {
  console.error(
    "Usage: pnpm plan:set <email> <free|go|plus|pro|business|daypass> [days]"
  );
  process.exit(1);
}

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is not defined");
  process.exit(1);
}

const now = new Date();
const days = planArg === "daypass" ? 1 : Number(daysArg ?? 31);
const periodStart =
  planArg === "daypass"
    ? now
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const periodEnd =
  planArg === "daypass"
    ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

const sql = postgres(connectionString, { max: 1 });

async function main() {
  try {
    const [user] = await sql`
    select id, email from "User" where email = ${email} limit 1
  `;
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exit(2);
    }

    await sql`
    insert into "Entitlement"
      ("userId", plan, status, "periodStart", "periodEnd", flags, "updatedAt")
    values
      (${user.id}, ${planArg}, 'active', ${periodStart}, ${periodEnd}, '{}'::jsonb, now())
    on conflict ("userId", "periodStart")
    do update set
      plan = excluded.plan,
      status = 'active',
      "periodEnd" = excluded."periodEnd",
      "updatedAt" = now()
  `;

    console.log(
      `Set ${user.email} to ${planArg} until ${periodEnd.toISOString()}`
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
