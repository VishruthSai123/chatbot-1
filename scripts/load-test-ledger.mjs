import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

config({ override: true, path: ".env.local" });

if (process.env.CONFIRM_LOAD_TEST !== "yes") {
  console.error(
    "Refusing to write load-test rows. Re-run with CONFIRM_LOAD_TEST=yes."
  );
  process.exit(1);
}

const url = process.env.POSTGRES_TRANSACTION_URL ?? process.env.POSTGRES_URL;
const sql = postgres(url, {
  connect_timeout: 10,
  idle_timeout: 20,
  max: 10,
  prepare: false,
  ssl: "require",
});

const subjects = Array.from({ length: 1000 }, () => randomUUID());
const now = new Date();
const periodStart = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
);
const periodEnd = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
);
const LIMIT = 123_456;
const AMOUNT = 60;

try {
  await sql`insert into "UsageCounter" ("subjectType","subjectId",kind,period,"periodStart","periodEnd",used,reserved,"limitValue") select 'user', id, 'live_seconds', 'month', ${periodStart}, ${periodEnd}, 0, 0, ${LIMIT} from unnest(${subjects}::uuid[]) as id`;
  const started = Date.now();
  await Promise.all(
    subjects.map(async (subjectId) => {
      await sql.begin(async (tx) => {
        await tx`update "UsageCounter" set reserved = reserved + ${AMOUNT}, "updatedAt" = now() where "subjectType"='user' and "subjectId"=${subjectId} and kind='live_seconds' and period='month' and "periodStart"=${periodStart}`;
        await tx`insert into "UsageReservation" ("subjectType","subjectId",kind,period,"periodStart",amount,status,"expiresAt") values ('user',${subjectId},'live_seconds','month',${periodStart},${AMOUNT},'held',now() + interval '10 minutes')`;
      });
    })
  );
  const [{ reserved }] =
    await sql`select coalesce(sum(reserved),0)::int as reserved from "UsageCounter" where "limitValue"=${LIMIT}`;
  const [{ count }] =
    await sql`select count(*)::int as count from "UsageReservation" where "subjectId" in ${sql(subjects)}`;
  console.log({
    elapsedMs: Date.now() - started,
    expected: 60_000,
    pass: Number(reserved) === 60_000 && count === 1000,
    reservations: count,
    reserved: Number(reserved),
  });
} finally {
  await sql`delete from "UsageReservation" where "subjectId" in ${sql(subjects)}`;
  await sql`delete from "UsageCounter" where "limitValue"=${LIMIT}`;
  await sql.end();
}
