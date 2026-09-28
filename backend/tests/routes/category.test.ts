import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = userId;
    next();
  },
}));

import { categoriesRouter } from "../../srcs/routes/category.ts";
import { dispatch } from "../helpers/dispatch.ts";

const categoryId = "550e8400-e29b-41d4-a716-446655440002";
const userId = "550e8400-e29b-41d4-a716-446655440001";

// Category row in schema column order:
// id, userId, name, icon, color, kind, isArchived, createdAt
function categoryRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? categoryId,
    overrides.userId ?? userId,
    overrides.name ?? "Food",
    overrides.icon ?? "🍔",
    overrides.color ?? "#2563EB",
    overrides.kind ?? "expense",
    overrides.isArchived ?? false,
    overrides.createdAt ?? new Date().toISOString(),
  ];
}

beforeEach(() => query.mockReset());

// ─── GET / ────────────────────────────────────────────────────────────────────

describe("GET /categories", () => {
  it("returns the list from listActiveCategories", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow()] });
    const result = await dispatch(categoriesRouter, { url: "/" });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it("returns [] for an empty result", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await dispatch(categoriesRouter, { url: "/" });
    expect(result).toEqual({ status: 200, body: [] });
  });

  it("filters on user_id and is_archived=false, orders by kind, name", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await dispatch(categoriesRouter, { url: "/" });
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('"user_id"');
    expect(sql).toContain('"is_archived"');
    expect(sql).toContain('"kind"');
    expect(sql).toContain('"name"');
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(categoriesRouter, { url: "/" })).rejects.toThrow();
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe("POST /categories", () => {
  function post(body: unknown) {
    return dispatch(categoriesRouter, { method: "POST", url: "/", body });
  }

  const validBody = { name: "Food", icon: "🍔", color: "#2563EB", kind: "expense" };

  it.each([
    [{ ...validBody, name: undefined }, "name must be between 1 and 80 characters"],
    [{ ...validBody, name: "  " }, "name must be between 1 and 80 characters"],
    [{ ...validBody, name: "a".repeat(81) }, "name must be between 1 and 80 characters"],
  ])("rejects invalid name", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, icon: undefined }, "icon must be between 1 and 100 characters"],
    [{ ...validBody, icon: "  " }, "icon must be between 1 and 100 characters"],
    [{ ...validBody, icon: "a".repeat(101) }, "icon must be between 1 and 100 characters"],
  ])("rejects invalid icon", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, color: undefined }, "color must be a hex value such as #2563EB"],
    [{ ...validBody, color: "#abc" }, "color must be a hex value such as #2563EB"],
    [{ ...validBody, color: "2563EB" }, "color must be a hex value such as #2563EB"],
    [{ ...validBody, color: "#GGGGGG" }, "color must be a hex value such as #2563EB"],
  ])("rejects invalid color", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, kind: undefined }, "kind must be expense, income, or transfer"],
    [{ ...validBody, kind: "savings" }, "kind must be expense, income, or transfer"],
  ])("rejects invalid kind", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 with no request body", async () => {
    expect((await post(undefined)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 409 when a duplicate name+kind exists", async () => {
    query.mockResolvedValueOnce({ rows: [[categoryId]] }); // findCategoryByNameAndKind → found
    const result = await post(validBody);
    expect(result).toEqual({
      status: 409,
      body: { error: "A category with this name and kind already exists" },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 201 on success, upper-cases color, uses userId", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // duplicate check → none
    query.mockResolvedValueOnce({ rows: [categoryRow({ color: "#2563EB" })] }); // insert

    const result = await post({ ...validBody, color: "#2563eb" });

    expect(result.status).toBe(201);
    const insertParams: unknown[] = query.mock.calls[1]![1];
    expect(insertParams).toContain("#2563EB");
    expect(insertParams).toContain(userId);
  });

  it.each(["expense", "income", "transfer"])("accepts kind %s", async (kind) => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [categoryRow({ kind })] });
    expect((await post({ ...validBody, kind })).status).toBe(201);
  });

  it("forwards errors", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // duplicate check
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(post(validBody)).rejects.toThrow();
  });
});

// ─── GET /:categoryId ─────────────────────────────────────────────────────────

describe("GET /categories/:categoryId", () => {
  it("rejects an invalid UUID", async () => {
    const result = await dispatch(categoriesRouter, { url: "/not-a-uuid" });
    expect(result).toEqual({ status: 400, body: { error: "categoryId must be a valid UUID" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await dispatch(categoriesRouter, { url: `/${categoryId}` })).toEqual({
      status: 404,
      body: { error: "Category not found" },
    });
  });

  it("returns 200 even for an archived category", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow({ isArchived: true })] });
    expect((await dispatch(categoriesRouter, { url: `/${categoryId}` })).status).toBe(200);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(categoriesRouter, { url: `/${categoryId}` })).rejects.toThrow();
  });
});

// ─── PATCH /:categoryId ───────────────────────────────────────────────────────

describe("PATCH /categories/:categoryId", () => {
  function patch(id: string, body: unknown) {
    return dispatch(categoriesRouter, { method: "PATCH", url: `/${id}`, body });
  }

  it("rejects an invalid UUID", async () => {
    expect((await patch("not-a-uuid", { name: "New" })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a body containing kind (even with valid value)", async () => {
    const result = await patch(categoryId, { kind: "expense" });
    expect(result).toEqual({ status: 400, body: { error: "A category kind cannot be changed" } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "  " }, "name must be between 1 and 80 characters"],
    [{ name: "a".repeat(81) }, "name must be between 1 and 80 characters"],
    [{ icon: "" }, "icon must be between 1 and 100 characters"],
    [{ color: "#abc" }, "color must be a hex value such as #2563EB"],
  ])("rejects invalid field %j", async (body, error) => {
    expect(await patch(categoryId, body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body or only non-editable fields", async () => {
    expect((await patch(categoryId, {})).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([true, false])("returns 200 when patching isArchived=%s", async (isArchived) => {
    query.mockResolvedValueOnce({ rows: [categoryRow()] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [categoryRow({ isArchived })] }); // updateCategory
    expect((await patch(categoryId, { isArchived })).status).toBe(200);
  });

  it("returns 404 when category not found, no UPDATE", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await patch(categoryId, { name: "New" })).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when rename conflicts with existing category", async () => {
    const otherId = "550e8400-e29b-41d4-a716-446655440099";
    query.mockResolvedValueOnce({ rows: [categoryRow()] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [[otherId]] }); // findCategoryByNameAndKind → conflict

    const result = await patch(categoryId, { name: "Conflict" });
    expect(result).toEqual({
      status: 409,
      body: { error: "A category with this name and kind already exists" },
    });
  });

  it("returns 200 when renaming to the same name (no conflict)", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow({ name: "Food" })] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [[categoryId]] }); // findCategoryByNameAndKind → same id
    query.mockResolvedValueOnce({ rows: [categoryRow({ name: "Food" })] }); // updateCategory

    const result = await patch(categoryId, { name: "Food" });
    expect(result.status).toBe(200);
  });

  it("does not run duplicate check when name is not in the body", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow()] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [categoryRow({ icon: "🏠" })] }); // updateCategory

    await patch(categoryId, { icon: "🏠" });
    expect(query).toHaveBeenCalledTimes(2); // no duplicate check
  });

  it("sets only sent fields, upper-cases color, does not set updated_at", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow()] });
    query.mockResolvedValueOnce({ rows: [categoryRow({ color: "#AABBCC" })] });

    await patch(categoryId, { color: "#aabbcc" });

    const updateSql: string = query.mock.calls[1]![0].text;
    expect(updateSql).not.toContain('"updated_at"');
    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain("#AABBCC");
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(patch(categoryId, { name: "New" })).rejects.toThrow();
  });
});
