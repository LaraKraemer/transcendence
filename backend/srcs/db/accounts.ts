import { and, eq, sum } from "drizzle-orm";

import { db } from "./client.ts";
import { accounts, transactions } from "./schema.ts";
import type { NewAccount } from "./schema.ts";

/** Finds an owned account, including archived accounts unless explicitly excluded. */
export async function findOwnedAccount(accountId: string, userId: string, allowArchived = true) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        allowArchived ? undefined : eq(accounts.isArchived, false),
      ),
    )
    .limit(1);

  return account;
}

export async function listActiveAccounts(userId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isArchived, false)));
}

export async function insertAccount(values: NewAccount) {
  const [account] = await db.insert(accounts).values(values).returning();
  return account;
}

/** Checks whether an account currently contains any transactions. */
export async function hasTransactions(accountId: string) {
  const [transaction] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .limit(1);

  return transaction !== undefined;
}

export async function sumTransactions(accountId: string) {
  const [result] = await db
    .select({ total: sum(transactions.amountMinor) })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  return Number(result?.total ?? 0);
}

export async function updateAccount(
  accountId: string,
  updates: Partial<Omit<NewAccount, "id" | "userId" | "createdAt">>,
) {
  const [account] = await db
    .update(accounts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning();

  return account;
}

export async function archiveAccount(accountId: string) {
  await db.update(accounts).set({ isArchived: true, updatedAt: new Date() }).where(eq(accounts.id, accountId));
}

/** Permanently deletes an owned account and cascades to its transactions. */
export async function deleteOwnedAccount(accountId: string, userId: string) {
  const [account] = await db
    .delete(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });

  return account !== undefined;
}
