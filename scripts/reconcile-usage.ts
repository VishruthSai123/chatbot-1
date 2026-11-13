import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import Papa from "papaparse";
import postgres from "postgres";

config({ override: true, path: ".env.local" });

const [, , csvPath] = process.argv;
if (!csvPath) {
  console.error(
    "Usage: pnpm reconcile <csv>  (columns: date,provider,cost_usd)"
  );
  process.exit(1);
}

async function main() {
  const raw = await readFile(csvPath, "utf8");
  const parsed = Papa.parse<{
    cost_usd: string;
    date: string;
    provider: string;
  }>(raw, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0) {
    console.error(parsed.errors);
    process.exit(1);
  }

  const invoiceByDate = new Map<string, number>();
  for (const row of parsed.data) {
    const date = row.date?.trim();
    const cost = Number(row.cost_usd);
    if (!(date && Number.isFinite(cost))) {
      continue;
    }
    invoiceByDate.set(date, (invoiceByDate.get(date) ?? 0) + cost);
  }

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("POSTGRES_URL is not defined");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1, ssl: "require" });

  try {
    const rows = await sql`
    select
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date,
      round(coalesce(sum("costUsd"), 0), 4) as ledger_usd
    from "UsageEvent"
    group by 1
    order by 1
  `;

    const allDates = new Set<string>([
      ...rows.map((row) => row.date),
      ...invoiceByDate.keys(),
    ]);

    const comparison = [...allDates].sort().map((date) => {
      const ledger = Number(
        rows.find((row) => row.date === date)?.ledger_usd ?? 0
      );
      const invoice = invoiceByDate.get(date) ?? 0;
      return {
        date,
        difference: Number((invoice - ledger).toFixed(4)),
        invoice_usd: Number(invoice.toFixed(4)),
        ledger_usd: Number(ledger.toFixed(4)),
      };
    });

    console.table(comparison);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
