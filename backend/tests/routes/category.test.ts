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
// id, userId, name, icon, color, types, createdAt
function categoryRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? categoryId,
    overrides.userId ?? userId,
    overrides.name ?? "Food",
    overrides.icon ?? "🍔",
    overrides.color ?? "#2563EB",
    overrides.types ?? ["expense"],
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

  it("lists only the user's categories, ordered by name", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await dispatch(categoriesRouter, { url: "/" });
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('where "category"."user_id" = $1');
    expect(sql).toContain('order by "category"."name"');
    expect(query.mock.calls[0]![1]).toEqual([userId]);
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

  const validBody = { name: "Food", icon: "🍔", color: "#2563EB", types: ["expense"] };

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

  it.each([[undefined], ["expense"], [[]], [["savings"]], [["transfer"]], [["expense", "transfer"]], [[1]]])(
    "rejects invalid types %j",
    async (types) => {
      expect(await post({ ...validBody, types })).toEqual({
        status: 400,
        body: { error: "types must be a non-empty list of expense and/or income" },
      });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("returns 400 with no request body", async () => {
    expect((await post(undefined)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 409 when the name is already used", async () => {
    query.mockResolvedValueOnce({ rows: [[categoryId]] }); // findCategoryByName → found
    const result = await post(validBody);
    expect(result).toEqual({
      status: 409,
      body: { error: "A category with this name already exists" },
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

  it.each([[["expense"]], [["income"]], [["expense", "income"]]])("accepts types %j", async (types) => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [categoryRow({ types })] });
    expect((await post({ ...validBody, types })).status).toBe(201);
  });

  it("stores duplicate types once, in canonical order", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [categoryRow({ types: ["expense", "income"] })] });
    await post({ ...validBody, types: ["income", "expense", "income"] });
    expect(query.mock.calls[1]![1]).toContain('{"expense","income"}');
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

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(categoriesRouter, { url: `/${categoryId}` })).rejects.toThrow();
  });
});

// ─── DELETE /:categoryId ──────────────────────────────────────────────────────

describe("DELETE /categories/:categoryId", () => {
  function del(id: string) {
    return dispatch(categoriesRouter, { method: "DELETE", url: `/${id}` });
  }

  it("rejects an invalid UUID", async () => {
    expect(await del("not-a-uuid")).toEqual({ status: 400, body: { error: "categoryId must be a valid UUID" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 204 and no body on success", async () => {
    query.mockResolvedValueOnce({ rows: [[categoryId]] });
    const result = await del(categoryId);
    expect(result).toEqual({ status: 204, body: undefined });
    expect(query).toHaveBeenCalledTimes(1);
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('delete from "category"');
    expect(sql).toContain('"id"');
    expect(query.mock.calls[0]![1]).toEqual([categoryId, userId]);
  });

  it("returns 404 for a missing or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await del(categoryId)).toEqual({ status: 404, body: { error: "Category not found" } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(del(categoryId)).rejects.toThrow();
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

  it.each([[[]], [["transfer"]], ["expense"]])("rejects invalid types %j", async (types) => {
    expect(await patch(categoryId, { types })).toEqual({
      status: 400,
      body: { error: "types must be a non-empty list of expense and/or income" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("changes types without querying transactions", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow()] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [categoryRow({ types: ["expense", "income"] })] }); // updateCategory
    const result = await patch(categoryId, { types: ["income", "expense"] });
    expect(result.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![0].text).toContain('update "category"');
    expect(query.mock.calls[1]![1]).toContain('{"expense","income"}');
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

  it("returns 404 when category not found, no UPDATE", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await patch(categoryId, { name: "New" })).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when rename conflicts with existing category", async () => {
    const otherId = "550e8400-e29b-41d4-a716-446655440099";
    query.mockResolvedValueOnce({ rows: [categoryRow()] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [[otherId]] }); // findCategoryByName → conflict

    const result = await patch(categoryId, { name: "Conflict" });
    expect(result).toEqual({
      status: 409,
      body: { error: "A category with this name already exists" },
    });
  });

  it("returns 200 when renaming to the same name (no conflict)", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow({ name: "Food" })] }); // findOwnedCategory
    query.mockResolvedValueOnce({ rows: [[categoryId]] }); // findCategoryByName → same id
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
