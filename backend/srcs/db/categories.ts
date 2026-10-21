import { and, eq, or } from "drizzle-orm";

import { db } from "./client.ts";
import { categories } from "./schema.ts";
import type { NewCategory } from "./schema.ts";

/** Id of the global read-only "Transfer" category, inserted by the migration. */
export const TRANSFER_CATEGORY_ID = "00000000-0000-4000-8000-000000000001";

/** Matches the user's own categories and the global system category. */
export function visibleTo(userId: string) {
  return or(eq(categories.userId, userId), eq(categories.isSystem, true));
}

export async function findOwnedCategory(categoryId: string, userId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);

  return category;
}

/** Finds a category the user can read: their own or the system category. */
export async function findVisibleCategory(categoryId: string, userId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), visibleTo(userId)))
    .limit(1);

  return category;
}

export async function findCategoryByName(userId: string, name: string) {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)))
    .limit(1);

  return category;
}

/** Lists the user's categories plus the system category. */
export async function listCategories(userId: string) {
  return db.select().from(categories).where(visibleTo(userId)).orderBy(categories.name);
}

export async function insertCategory(values: NewCategory) {
  const [category] = await db.insert(categories).values(values).returning();
  return category;
}

export async function updateCategory(
  categoryId: string,
  updates: Partial<Pick<NewCategory, "name" | "icon" | "color" | "types">>,
) {
  const [category] = await db.update(categories).set(updates).where(eq(categories.id, categoryId)).returning();

  return category;
}

/** Deletes a category owned by the user; linked transactions keep existing with `categoryId = null`. Returns whether a row was deleted. */
export async function deleteOwnedCategory(categoryId: string, userId: string) {
  const [category] = await db
    .delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .returning({ id: categories.id });

  return category !== undefined;
}
