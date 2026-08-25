import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  // Money is stored as integer cents, never a float: 0.1 + 0.2 !== 0.3 in
  // binary floating point, and those errors accumulate when summing expenses.
  amountCents: integer("amount_cents").notNull(),
  category: text("category"),
  spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
