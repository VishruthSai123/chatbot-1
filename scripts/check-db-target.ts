import { config } from "dotenv";

import { migrationDecision } from "../lib/db/migration-policy";

config({ path: ".env.local" });

const url = process.env.POSTGRES_TRANSACTION_URL ?? process.env.POSTGRES_URL;

function describe(value: string | undefined) {
  if (!value) {
    return "not configured";
  }

  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "invalid URL";
  }
}

const decision = migrationDecision(
  process.env as Parameters<typeof migrationDecision>[0]
);

console.log(`runtime database: ${describe(url)}`);
console.log(`migration database: ${describe(process.env.POSTGRES_URL)}`);
console.log(
  `migrations: ${decision.run ? "run" : "skip"} (${decision.reason})`
);
