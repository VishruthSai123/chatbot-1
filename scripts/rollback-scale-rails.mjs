import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

if (process.env.CONFIRM_ROLLBACK !== "yes") {
  console.error(
    "Refusing to drop usage tables. Re-run with CONFIRM_ROLLBACK=yes if you really want to delete them."
  );
  process.exit(1);
}

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is not defined");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  await sql`
    drop table if exists
      "UsageEvent",
      "UsageReservation",
      "UsageCounter",
      "LiveSession",
      "Entitlement",
      "PriceBook"
    cascade
  `;
  console.log("Dropped scale-rail tables.");
  console.log(
    "The 0002_scale_rails migration is still recorded in the Drizzle journal. Remove that entry before re-applying it."
  );
} finally {
  await sql.end();
}
