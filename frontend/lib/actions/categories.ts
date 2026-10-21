"use server";

/**
 * Category server actions. Like lib/actions/accounts.ts, they validate with Zod
 * and return CategoryErrorCodes (see lib/validation.ts) instead of sentences.
 */
import { refresh } from "next/cache";
import { z } from "zod";

import { isCategoryIconKey } from "@/components/categories/category-icon";
import { backendFailure } from "@/lib/action-errors";
import { ApiError } from "@/lib/api";
import { fetchApiServer } from "@/lib/dal";
import type { ActionResponse, Category } from "@/lib/types";
import {
  CATEGORY_TYPES,
  HEX_COLOR_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  changedCategoryFields,
  type CategoryErrorCode,
  type EditableCategoryFields,
} from "@/lib/validation";

const categoryIdSchema = z.uuid();

const CreateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "nameRequired" satisfies CategoryErrorCode })
    .max(MAX_CATEGORY_NAME_LENGTH, { error: "nameTooLong" satisfies CategoryErrorCode }),
  // Only the icons the form offers, so every saved category can be drawn.
  icon: z.string().refine(isCategoryIconKey, { error: "iconInvalid" satisfies CategoryErrorCode }),
  color: z
    .string()
    .trim()
    .regex(HEX_COLOR_PATTERN, { error: "colorInvalid" satisfies CategoryErrorCode }),
  types: z
    .array(z.enum(CATEGORY_TYPES, { error: "typesInvalid" satisfies CategoryErrorCode }), {
      error: "typesInvalid" satisfies CategoryErrorCode,
    })
    .min(1, { error: "typesInvalid" satisfies CategoryErrorCode }),
});

// Raw form values: the text fields and the checked types arrive as plain strings and are checked here.
export type CreateCategoryInput = Record<"name" | "icon" | "color", string> & { types: string[] };

/** Validates input, creates the category with `POST /categories`, and refreshes the page. */
export async function createCategory(data: CreateCategoryInput): Promise<ActionResponse> {
  const parsed = CreateCategorySchema.safeParse({
    name: String(data.name),
    icon: String(data.icon),
    color: String(data.color),
    types: Array.isArray(data.types) ? data.types.map(String) : [],
  });
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await fetchApiServer<Category>("/categories", { method: "POST", body: JSON.stringify(parsed.data) });
  } catch (error) {
    // (user, name) is unique: a duplicate belongs next to the name field.
    if (error instanceof ApiError && error.status === 409) {
      return { success: false, message: error.message, status: 409, errors: { name: ["nameTaken"] } };
    }
    return backendFailure(error, "createCategory");
  }

  refresh();
  return { success: true, message: "Category created" };
}

/**
 * Validates the edit form and sends only the fields the user changed with
 * `PATCH /categories/:id`, by comparing against the values the form was opened
 * with (like updateAccount). Changing the types never touches existing transactions.
 */
export async function updateCategory(
  categoryId: string,
  opened: EditableCategoryFields,
  data: CreateCategoryInput,
): Promise<ActionResponse> {
  if (!categoryIdSchema.safeParse(categoryId).success) {
    return { success: false, message: "Category not found", status: 404 };
  }
  const parsed = CreateCategorySchema.safeParse({
    name: String(data.name),
    icon: String(data.icon),
    color: String(data.color),
    types: Array.isArray(data.types) ? data.types.map(String) : [],
  });
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const updates = changedCategoryFields(opened, parsed.data);
  // Nothing changed: the backend would reject an empty PATCH, and there is nothing to save or reload.
  if (Object.keys(updates).length === 0) return { success: true, message: "No changes" };

  try {
    await fetchApiServer<Category>(`/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(updates) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { success: false, message: error.message, status: 409, errors: { name: ["nameTaken"] } };
    }
    return backendFailure(error, "updateCategory");
  }

  refresh();
  return { success: true, message: "Category updated" };
}

/**
 * How many transactions use the category (`GET /transactions/count/:categoryId`),
 * for the warning before deleting it. `null` when the count couldn't be loaded.
 */
export async function countCategoryTransactions(categoryId: string): Promise<number | null> {
  if (!categoryIdSchema.safeParse(categoryId).success) return null;
  try {
    const { transactionCount } = await fetchApiServer<{ transactionCount: number }>(
      `/transactions/count/${categoryId}`,
    );
    return transactionCount;
  } catch (error) {
    console.error("countCategoryTransactions: request failed:", error);
    return null;
  }
}

/**
 * Permanently deletes the category with `DELETE /categories/:id`. Its
 * transactions are kept; the backend sets their category to none.
 */
export async function deleteCategory(categoryId: string): Promise<ActionResponse> {
  if (!categoryIdSchema.safeParse(categoryId).success) {
    return { success: false, message: "Category not found", status: 404 };
  }
  try {
    await fetchApiServer<void>(`/categories/${categoryId}`, { method: "DELETE" });
  } catch (error) {
    return backendFailure(error, "deleteCategory");
  }

  refresh();
  return { success: true, message: "Category deleted" };
}
