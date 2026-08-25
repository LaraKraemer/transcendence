import "dotenv/config";

import { db, pool } from "./client.ts";
import { expenses, type NewExpense } from "./schema.ts";

const SAMPLE: NewExpense[] = [
  { description: "Groceries", amountCents: 4250, category: "food" },
  { description: "Monthly transit pass", amountCents: 4900, category: "transport" },
  { description: "Coffee with the team", amountCents: 1180, category: "food" },
  { description: "Notebook and pens", amountCents: 799, category: "supplies" },
  { description: "Cinema ticket", amountCents: 1350, category: "leisure" },
];

async function seed(): Promise<void> {
  const existing = await db.select({ id: expenses.id }).from(expenses).limit(1);

  // noUncheckedIndexedAccess makes existing[0] `T | undefined`, so length is
  // the clean check here. Idempotent: re-running never duplicates rows.
  if (existing.length > 0) {
    console.log("Expenses already present, skipping seed");
    return;
  }

  await db.insert(expenses).values(SAMPLE);
  console.log(`Seeded ${SAMPLE.length} expenses`);
}

try {
  await seed();
} finally {
  await pool.end();
}
