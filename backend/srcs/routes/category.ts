import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import {
  archiveCategory,
  findCategoryByNameAndKind,
  findOwnedCategory,
  insertCategory,
  listActiveCategories,
  updateCategory,
} from "../db/categories.ts";
import { isHexColor, isUuid } from "../validation.ts";

const CATEGORY_KINDS = ["expense", "income", "transfer"] as const;
type CategoryKind = (typeof CATEGORY_KINDS)[number];

function isCategoryKind(value: unknown): value is CategoryKind {
  return (
    typeof value === "string" &&
    CATEGORY_KINDS.includes(value as CategoryKind)
  );
}

export const categoriesRouter = Router();

categoriesRouter.use(requireAuthenticatedUser);

/** Returns all active categories belonging to the authenticated user. */
categoriesRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await listActiveCategories(res.locals.userId);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/** Creates an expense, income, or transfer category for the authenticated user. */
categoriesRouter.post("/", async (req, res, next) => {
  const { name, icon, color, kind } = req.body ?? {};

  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.trim().length > 80
  ) {
    res.status(400).json({ error: "name must be between 1 and 80 characters" });
    return;
  }

  if (
    typeof icon !== "string" ||
    icon.trim().length === 0 ||
    icon.trim().length > 100
  ) {
    res.status(400).json({ error: "icon must be between 1 and 100 characters" });
    return;
  }

  if (!isHexColor(color)) {
    res.status(400).json({ error: "color must be a hex value such as #2563EB" });
    return;
  }

  if (!isCategoryKind(kind)) {
    res.status(400).json({ error: "kind must be expense, income, or transfer" });
    return;
  }

  try {
    const existingCategory = await findCategoryByNameAndKind(res.locals.userId, name.trim(), kind);
    if (existingCategory) {
      res.status(409).json({ error: "A category with this name and kind already exists" });
      return;
    }

    const category = await insertCategory({
      userId: res.locals.userId,
      name: name.trim(),
      icon: icon.trim(),
      color: color.toUpperCase(),
      kind,
    });

    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

/** Returns one category owned by the authenticated user. */
categoriesRouter.get("/:categoryId", async (req, res, next) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  try {
    const category = await findOwnedCategory(req.params.categoryId, res.locals.userId);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(category);
  } catch (error) {
    next(error);
  }
});

/** Updates the display properties of a category owned by the authenticated user. */
categoriesRouter.patch("/:categoryId", async (req, res, next) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};
  const updates: { name?: string; icon?: string; color?: string; isArchived?: boolean } = {};

  if (Object.hasOwn(body, "kind")) {
    res.status(400).json({ error: "A category kind cannot be changed" });
    return;
  }

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

  if (Object.hasOwn(body, "isArchived")) {
    if (typeof body.isArchived !== "boolean") {
      res.status(400).json({ error: "isArchived must be a boolean" });
      return;
    }
    updates.isArchived = body.isArchived;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one editable category field" });
    return;
  }

  try {
    const category = await findOwnedCategory(req.params.categoryId, res.locals.userId);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    if (updates.name) {
      const existingCategory = await findCategoryByNameAndKind(res.locals.userId, updates.name, category.kind);
      if (existingCategory && existingCategory.id !== category.id) {
        res.status(409).json({ error: "A category with this name and kind already exists" });
        return;
      }
    }

    const updatedCategory = await updateCategory(category.id, updates);
    res.json(updatedCategory);
  } catch (error) {
    next(error);
  }
});
