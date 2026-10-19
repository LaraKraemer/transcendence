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
  CATEGORY_KINDS,
  HEX_COLOR_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  type CategoryErrorCode,
} from "@/lib/validation";

const CreateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "nameRequired" satisfies CategoryErrorCode })
    .max(MAX_CATEGORY_NAME_LENGTH, { error: "nameTooLong" satisfies CategoryErrorCode }),
  // Only the icons the form offers, so every saved category can be drawn.
  icon: z.string().refine(isCategoryIconKey, { error: "iconInvalid" satisfies CategoryErrorCode }),
  color: z.string().trim().regex(HEX_COLOR_PATTERN, { error: "colorInvalid" satisfies CategoryErrorCode }),
  kind: z.enum(CATEGORY_KINDS, { error: "kindInvalid" satisfies CategoryErrorCode }),
});

// Raw form values: everything arrives as a string and is checked here.
export type CreateCategoryInput = Record<keyof z.input<typeof CreateCategorySchema>, string>;

/** Validates input, creates the category with `POST /categories`, and refreshes the page. */
export async function createCategory(data: CreateCategoryInput): Promise<ActionResponse> {
  const parsed = CreateCategorySchema.safeParse({
    name: String(data.name),
    icon: String(data.icon),
    color: String(data.color),
    kind: String(data.kind),
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
    // (user, name, kind) is unique: a duplicate belongs next to the name field.
    if (error instanceof ApiError && error.status === 409) {
      return { success: false, message: error.message, status: 409, errors: { name: ["nameTaken"] } };
    }
    return backendFailure(error, "createCategory");
  }

  refresh();
  return { success: true, message: "Category created" };
}

/**
 * Archives a category with `PATCH { isArchived: true }` (the backend has no
 * DELETE for categories). Transactions keep their category; it just can't be
 * picked for new ones.
 */
export async function archiveCategory(categoryId: string): Promise<ActionResponse> {
  if (!z.uuid().safeParse(categoryId).success) {
    return { success: false, message: "Category not found", status: 404 };
  }
  try {
    await fetchApiServer<Category>(`/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ isArchived: true }),
    });
  } catch (error) {
    return backendFailure(error, "archiveCategory");
  }

  refresh();
  return { success: true, message: "Category archived" };
}
