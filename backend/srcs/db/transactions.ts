import { and, count, desc, eq, getTableColumns, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "./client.ts";
import { accounts, categories, transactions } from "./schema.ts";
import type { NewTransaction, Transaction } from "./schema.ts";

/** Finds a transaction only when its account belongs to the authenticated user, including archived accounts. */
export async function findOwnedTransaction(transactionId: string, userId: string) {
  const [transaction] = await db
    .select({ transaction: getTableColumns(transactions), accountIsArchived: accounts.isArchived })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.id, transactionId), eq(accounts.userId, userId)))
    .limit(1);

  return transaction;
}

/** Finds the types of a category owned by the user. */
export async function findCategoryTypes(categoryId: string, userId: string) {
  const [category] = await db
    .select({ types: categories.types })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);

  return category;
}

/**
 * Lists one page of transactions, newest first, plus the total number of matches. The owner is one
 * account, or a user: then the transactions of all their accounts, archived ones included.
 */
export async function listTransactions(
  owner: { accountId: string } | { userId: string },
  options: {
    limit: number;
    offset: number;
    from?: string;
    to?: string;
  },
) {
  const { limit, offset, from, to } = options;
  const whereClause = and(
    "accountId" in owner
      ? eq(transactions.accountId, owner.accountId)
      : inArray(
          transactions.accountId,
          db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, owner.userId)),
        ),
    from === undefined ? undefined : gte(transactions.bookedOn, from),
    to === undefined ? undefined : lte(transactions.bookedOn, to),
  );
  // The other leg of a transfer, so a one-account list can name the account the money came from or went to.
  const otherLeg = alias(transactions, "other_leg");
  const [items, totals] = await Promise.all([
    db
      .select({ ...getTableColumns(transactions), transferAccountId: otherLeg.accountId })
      .from(transactions)
      .leftJoin(
        otherLeg,
        and(eq(otherLeg.transferGroupId, transactions.transferGroupId), ne(otherLeg.id, transactions.id)),
      )
      .where(whereClause)
      .orderBy(desc(transactions.bookedOn), desc(transactions.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(transactions).where(whereClause),
  ]);

  return { items, total: totals[0]!.total };
}

export async function summarizeTransactionsByCategory(accountId: string, from?: string, to?: string) {
  return db
    .select({
      categoryId: transactions.categoryId,
      type: transactions.type,
      totalMinor: sql<number>`SUM(${transactions.amountMinor})`.mapWith(Number),
      count: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        ...(from ? [gte(transactions.bookedOn, from)] : []),
        ...(to ? [lte(transactions.bookedOn, to)] : []),
      ),
    )
    .groupBy(transactions.categoryId, transactions.type);
}

/** Returns the number of transactions linked to a category, scoped to the owning user via account join. */
export async function countTransactionsByCategory(categoryId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.categoryId, categoryId), eq(accounts.userId, userId)));
  return row?.n ?? 0;
}

export async function insertTransaction(values: NewTransaction) {
  const [transaction] = await db.insert(transactions).values(values).returning();
  return transaction;
}

/** Inserts both legs of a transfer in one statement, so either both exist or neither does. */
export async function insertTransferLegs(legs: NewTransaction[]) {
  return db.insert(transactions).values(legs).returning();
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

/** Permanently deletes a transaction after the caller has checked ownership. A transfer is deleted together with its other leg. */
export async function deleteTransaction({ id, transferGroupId }: Pick<Transaction, "id" | "transferGroupId">) {
  await db
    .delete(transactions)
    .where(transferGroupId === null ? eq(transactions.id, id) : eq(transactions.transferGroupId, transferGroupId));
}
