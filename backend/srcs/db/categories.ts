import { and, eq } from "drizzle-orm";

import { db } from "./client.ts";
import { categories } from "./schema.ts";
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

export async function listActiveCategories(userId: string) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.isArchived, false)))
    .orderBy(categories.kind, categories.name);
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

export async function archiveCategory(categoryId: string) {
  await db.update(categories).set({ isArchived: true }).where(eq(categories.id, categoryId));
}
