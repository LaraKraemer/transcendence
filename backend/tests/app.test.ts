import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { EventEmitter } = await import("node:events");
  const pool = Object.assign(new EventEmitter(), { query });
  return { db: drizzle({ query } as unknown as import("pg").Pool), pool };
});

import { createApp } from "../srcs/app.ts";

let server: Server;
let base: string;

beforeAll(() => {
  return new Promise<void>((resolve) => {
    server = createApp().listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(() => query.mockReset());

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ─── Root and health ──────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns 200 Expense Tracker API", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Expense Tracker API");
  });
});

describe("GET /health", () => {
  it("returns 200 { status: ok, db: ok } when pool.query resolves", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 { status: error, db: unreachable } when pool.query rejects", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", db: "unreachable" });
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe("CORS", () => {
  it("reflects the configured origin with credentials for allowed origins", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await fetch(`${base}/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not reflect foreign origins", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await fetch(`${base}/health`, {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("http://evil.com");
  });

  it("handles OPTIONS preflight for JSON PATCH, returns 204", async () => {
    const res = await fetch(`${base}/accounts`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    expect(methods.toUpperCase()).toContain("PATCH");
  });
});

// ─── Wiring ───────────────────────────────────────────────────────────────────

describe("wiring", () => {
  it("/auth/me without a cookie → 401 JSON", async () => {
    // session lookup returns nothing
    query.mockResolvedValueOnce({ rows: [] });
    const res = await fetch(`${base}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("json");
  });

  it("unknown path → 404", async () => {
    const res = await fetch(`${base}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("cookie-parser is mounted: Cookie header reaches session lookup as sha256", async () => {
    // PUT the session token in the cookie; the query is called with a hash
    query.mockResolvedValueOnce({ rows: [] }); // session lookup returns nothing → 401
    const res = await fetch(`${base}/auth/me`, {
      headers: { Cookie: "session=abc" },
    });
    expect(res.status).toBe(401);
    expect(query).toHaveBeenCalledTimes(1);
    // The token "abc" is NOT in the params; its sha256 is
    const params: unknown[] = query.mock.calls[0]![1];
    expect(params).not.toContain("abc");
    // sha256("abc") = "ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469564232170776f4e9d" — just verify not raw
    expect(typeof params[0]).toBe("string");
    expect((params[0] as string).length).toBe(64); // hex sha256
  });

  it("express.json() is mounted: JSON body reaches the user lookup", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail → not found → 401
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "somepassword" }),
    });
    expect(res.status).toBe(401);
    expect(query).toHaveBeenCalledTimes(1);
    const params: unknown[] = query.mock.calls[0]![1];
    expect(params).toContain("alice@example.com");
  });

  it("error handler is mounted: failing query → 500 JSON", async () => {
    query.mockRejectedValueOnce(new Error("DB down")); // session lookup fails
    const res = await fetch(`${base}/auth/me`, {
      headers: { Cookie: "session=tok" },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
