import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { TransactionImport } from "../transaction-import.ts";
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
 * Lists one filtered, sorted page of transactions, plus the total number of matches. The owner is one
 * account, or a user: then the transactions of all their accounts, archived ones included. Across all
 * accounts a transfer is one item: its source leg, with the other leg's account and amount.
 */
export async function listTransactions(
  owner: { accountId: string } | { userId: string },
  options: {
    limit: number;
    offset: number;
    type?: string;
    searchTerm?: string;
    categoryId?: string;
    minAmountMinor?: number;
    maxAmountMinor?: number;
    sort?: "bookedOn" | "amountMinor" | "createdAt";
    order?: "asc" | "desc";
    from?: string;
    to?: string;
  },
) {
  const {
    limit,
    offset,
    type,
    from,
    to,
    searchTerm,
    categoryId,
    minAmountMinor,
    maxAmountMinor,
    sort = "bookedOn",
    order = "desc",
  } = options;
  const direction = order === "asc" ? asc : desc;
  const sortColumn = {
    bookedOn: transactions.bookedOn,
    amountMinor: transactions.amountMinor,
    createdAt: transactions.createdAt,
  }[sort];
  const searchPattern = searchTerm === undefined ? undefined : `%${searchTerm.replace(/[\\%_]/g, "\\$&")}%`;
  const absoluteAmount = sql`abs(${transactions.amountMinor})`;
  // The other leg of a transfer: it names the account the money came from or went to.
  const otherLeg = alias(transactions, "other_leg");
  const otherLegJoin = and(
    eq(otherLeg.transferGroupId, transactions.transferGroupId),
    ne(otherLeg.id, transactions.id),
  );
  const whereClause = and(
    "accountId" in owner
      ? eq(transactions.accountId, owner.accountId)
      : inArray(
          transactions.accountId,
          db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, owner.userId)),
        ),
    type === undefined ? undefined : eq(transactions.type, type),
    categoryId === undefined
      ? undefined
      : categoryId === "none"
        ? isNull(transactions.categoryId)
        : eq(transactions.categoryId, categoryId),
    minAmountMinor === undefined ? undefined : gte(absoluteAmount, minAmountMinor),
    maxAmountMinor === undefined ? undefined : lte(absoluteAmount, maxAmountMinor),
    // ponytail: substring search scans at personal-expense scale; upgrade to a pg_trgm GIN index if needed.
    searchPattern === undefined
      ? undefined
      : or(
          ilike(transactions.description, searchPattern),
          ilike(transactions.merchant, searchPattern),
          ilike(transactions.notes, searchPattern),
        ),
    from === undefined ? undefined : gte(transactions.bookedOn, from),
    to === undefined ? undefined : lte(transactions.bookedOn, to),
    // Both legs are in the all-accounts list, so the destination leg is left out. A lone leg stays.
    "accountId" in owner ? undefined : or(isNull(otherLeg.id), lt(transactions.amountMinor, 0)),
  );
  const [items, totals] = await Promise.all([
    db
      .select({
        ...getTableColumns(transactions),
        transferAccountId: otherLeg.accountId,
        transferAmountMinor: otherLeg.amountMinor,
      })
      .from(transactions)
      .leftJoin(otherLeg, otherLegJoin)
      .where(whereClause)
      .orderBy(
        direction(sortColumn),
        ...(sort === "bookedOn" ? [direction(transactions.createdAt)] : []),
        direction(transactions.id),
      )
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(transactions).leftJoin(otherLeg, otherLegJoin).where(whereClause),
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

/** Locks the destination against concurrent archive/currency edits, then inserts the batch in one statement. */
export async function importTransactions(
  accountId: string,
  userId: string,
  document: TransactionImport,
): Promise<{ imported: number } | { status: number; error: string }> {
  return db.transaction(async (transaction) => {
    const [account] = await transaction
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1)
      .for("update");
    if (!account) return { status: 404, error: "Account not found" };
    if (account.isArchived) return { status: 409, error: "Account is archived. Restore it before making changes." };
    if (account.currencyCode !== document.currency)
      return { status: 400, error: "Import currency must match the destination account" };
    const categoryNames = [
      ...new Set(document.transactions.flatMap((entry) => (entry.category ? [entry.category] : []))),
    ];
    const matchingCategories =
      categoryNames.length === 0
        ? []
        : await transaction
            .select({ id: categories.id, name: categories.name, types: categories.types })
            .from(categories)
            .where(and(eq(categories.userId, userId), inArray(categories.name, categoryNames)))
            .for("share");
    const categoriesByName = new Map(matchingCategories.map((category) => [category.name, category]));
    const entries: NewTransaction[] = [];
    for (const [index, { category: categoryName, ...entry }] of document.transactions.entries()) {
      const category = categoryName ? categoriesByName.get(categoryName) : undefined;
      if (categoryName && !category) return { status: 400, error: `Row ${index + 1}: category not found` };
      if (category && !category.types.includes(entry.type))
        return { status: 400, error: `Row ${index + 1}: category does not allow ${entry.type}` };
      entries.push({ ...entry, accountId: account.id, createdById: userId, categoryId: category?.id ?? null });
    }
    const inserted = await transaction.insert(transactions).values(entries).returning({ id: transactions.id });
    return { imported: inserted.length };
  });
}
