import { and, count, eq } from "drizzle-orm";

import { db } from "./client.ts";
import { accounts, categories, transactions } from "./schema.ts";
import type { NewCategory } from "./schema.ts";

export async function findOwnedCategory(categoryId: string, userId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);

  return category;
}

export async function findCategoryByNameAndKind(userId: string, name: string, kind: string) {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name), eq(categories.kind, kind)))
    .limit(1);

  return category;
}

export async function listCategories(userId: string) {
  return db.select().from(categories).where(eq(categories.userId, userId)).orderBy(categories.kind, categories.name);
}

export async function insertCategory(values: NewCategory) {
  const [category] = await db.insert(categories).values(values).returning();
  return category;
}

export async function updateCategory(
  categoryId: string,
  updates: Partial<Pick<NewCategory, "name" | "icon" | "color">>,
) {
  const [category] = await db.update(categories).set(updates).where(eq(categories.id, categoryId)).returning();

  return category;
}

/** Returns the number of transactions linked to this category, scoped to the owning user via account join. */
export async function countTransactionsByCategory(categoryId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.categoryId, categoryId), eq(accounts.userId, userId)));
  return row!.n;
}

export async function deleteOwnedCategory(categoryId: string, userId: string) {
  const [category] = await db
    .delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .returning({ id: categories.id });

  return category !== undefined;
}
