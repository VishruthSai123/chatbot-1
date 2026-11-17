import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationDecision } from "./migration-policy";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  const decision = migrationDecision(
    process.env as Parameters<typeof migrationDecision>[0]
  );

  if (!decision.run) {
    console.log(`Skipping migrations: ${decision.reason}.`);
    process.exit(0);
  }

  if (!process.env.POSTGRES_URL) {
    console.log("POSTGRES_URL not defined, skipping migrations");
    process.exit(0);
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log(`Running migrations (${decision.reason})...`);

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
