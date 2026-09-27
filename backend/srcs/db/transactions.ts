import { and, desc, eq, getTableColumns, gte, lte, ne, sql } from "drizzle-orm";

import { db } from "./client.ts";
import { accounts, categories, transactions } from "./schema.ts";
import type { NewTransaction } from "./schema.ts";

/** Finds a transaction only when its account belongs to the authenticated user, including archived accounts. */
export async function findOwnedTransaction(transactionId: string, userId: string) {
  const [transaction] = await db
    .select(getTableColumns(transactions))
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.id, transactionId), eq(accounts.userId, userId)))
    .limit(1);

  return transaction;
}

export async function findCategoryKind(categoryId: string, userId: string, allowArchived: boolean) {
  const [category] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.userId, userId),
        allowArchived ? undefined : eq(categories.isArchived, false),
      ),
    )
    .limit(1);

  return category;
}

export async function listTransactionsByAccount(accountId: string) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .orderBy(desc(transactions.bookedOn), desc(transactions.createdAt));
}

export async function summarizeTransactionsByCategory(
  accountId: string,
  from?: string,
  to?: string,
) {
  return db
    .select({
      categoryId: transactions.categoryId,
      totalMinor: sql<number>`SUM(${transactions.amountMinor})`.mapWith(Number),
      count: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        ne(transactions.status, "void"),
        ...(from ? [gte(transactions.bookedOn, from)] : []),
        ...(to ? [lte(transactions.bookedOn, to)] : []),
      ),
    )
    .groupBy(transactions.categoryId);
}

export async function insertTransaction(values: NewTransaction) {
  const [transaction] = await db.insert(transactions).values(values).returning();
  return transaction;
}

export async function updateTransaction(
  transactionId: string,
  updates: Partial<Omit<NewTransaction, "id" | "accountId" | "createdById" | "createdAt">>,
) {
  const [transaction] = await db
    .update(transactions)
    .set(updates)
    .where(eq(transactions.id, transactionId))
    .returning();

  return transaction;
}

export async function voidTransaction(transactionId: string) {
  await db
    .update(transactions)
    .set({ status: "void", updatedAt: new Date() })
    .where(eq(transactions.id, transactionId));
}
