import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import {
  deleteOwnedCategory,
  findCategoryByName,
  findOwnedCategory,
  insertCategory,
  listCategories,
  updateCategory,
} from "../db/categories.ts";
import { isHexColor, isUuid } from "../validation.ts";

// Transfers have no category, so a category is only ever for expenses and/or income.
const CATEGORY_TYPES = ["expense", "income"] as const;
type CategoryType = (typeof CATEGORY_TYPES)[number];

const TYPES_ERROR = "types must be a non-empty list of expense and/or income";

/** Returns the valid, de-duplicated types in canonical order, or undefined when the value is not a valid non-empty list. */
function parseCategoryTypes(value: unknown): CategoryType[] | undefined {
  if (!Array.isArray(value) || !value.every((type) => CATEGORY_TYPES.includes(type))) return undefined;
  const types = CATEGORY_TYPES.filter((type) => value.includes(type));
  return types.length === 0 ? undefined : types;
}

export const categoriesRouter = Router();

categoriesRouter.use(requireAuthenticatedUser);

/** Returns the authenticated user's categories. */
categoriesRouter.get("/", async (_req, res) => {
  const rows = await listCategories(res.locals.userId);
  res.json(rows);
});

/** Creates an expense and/or income category for the authenticated user. */
categoriesRouter.post("/", async (req, res) => {
  const { name, icon, color, types: requestedTypes } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 80) {
    res.status(400).json({ error: "name must be between 1 and 80 characters" });
    return;
  }

  if (typeof icon !== "string" || icon.trim().length === 0 || icon.trim().length > 100) {
    res.status(400).json({ error: "icon must be between 1 and 100 characters" });
    return;
  }

  if (!isHexColor(color)) {
    res.status(400).json({ error: "color must be a hex value such as #2563EB" });
    return;
  }

  const types = parseCategoryTypes(requestedTypes);
  if (!types) {
    res.status(400).json({ error: TYPES_ERROR });
    return;
  }

  const existingCategory = await findCategoryByName(res.locals.userId, name.trim());
  if (existingCategory) {
    res.status(409).json({ error: "A category with this name already exists" });
    return;
  }

  const category = await insertCategory({
    userId: res.locals.userId,
    name: name.trim(),
    icon: icon.trim(),
    color: color.toUpperCase(),
    types,
  });

  res.status(201).json(category);
});

/** Returns one category owned by the authenticated user. */
categoriesRouter.get("/:categoryId", async (req, res) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  const category = await findOwnedCategory(req.params.categoryId, res.locals.userId);
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json(category);
});

/** Permanently deletes a category owned by the authenticated user. Linked transactions have their categoryId set to null. */
categoriesRouter.delete("/:categoryId", async (req, res, next) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  try {
    const deleted = await deleteOwnedCategory(req.params.categoryId, res.locals.userId);
    if (!deleted) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Updates the name, icon, color or types of a category owned by the authenticated user.
 * Changing the types never touches existing transactions.
 */
categoriesRouter.patch("/:categoryId", async (req, res) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};
  const updates: { name?: string; icon?: string; color?: string; types?: CategoryType[] } = {};

  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 80) {
      res.status(400).json({ error: "name must be between 1 and 80 characters" });
      return;
    }
    updates.name = body.name.trim();
  }

  if (Object.hasOwn(body, "icon")) {
    if (typeof body.icon !== "string" || body.icon.trim().length === 0 || body.icon.trim().length > 100) {
      res.status(400).json({ error: "icon must be between 1 and 100 characters" });
      return;
    }
    updates.icon = body.icon.trim();
  }

  if (Object.hasOwn(body, "color")) {
    if (!isHexColor(body.color)) {
      res.status(400).json({ error: "color must be a hex value such as #2563EB" });
      return;
    }
    updates.color = body.color.toUpperCase();
  }

  if (Object.hasOwn(body, "types")) {
    const types = parseCategoryTypes(body.types);
    if (!types) {
      res.status(400).json({ error: TYPES_ERROR });
      return;
    }
    updates.types = types;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one editable category field" });
    return;
  }

  const category = await findOwnedCategory(req.params.categoryId, res.locals.userId);
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  if (updates.name) {
    const existingCategory = await findCategoryByName(res.locals.userId, updates.name);
    if (existingCategory && existingCategory.id !== category.id) {
      res.status(409).json({ error: "A category with this name already exists" });
      return;
    }
  }

  const updatedCategory = await updateCategory(category.id, updates);
  res.json(updatedCategory);
});
