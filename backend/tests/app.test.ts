import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

/** Starts a loopback server with auth settings isolated from the host environment. */
async function startAppServer(env: Record<string, string> = {}) {
  for (const name of ["AUTH_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_MAX", "TRUST_PROXY"]) {
    vi.stubEnv(name, env[name]);
  }
  const appServer = createApp().listen(0, "127.0.0.1");
  await once(appServer, "listening");
  const { port } = appServer.address() as AddressInfo;
  return { server: appServer, base: `http://127.0.0.1:${port}` };
}

beforeAll(() => {
  return startAppServer().then((started) => {
    server = started.server;
    base = started.base;
  });
});

afterEach(() => {
  query.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => server && new Promise<void>((resolve) => server.close(() => resolve())));

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

  it("redacts database error parameters and detail from logs", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // email lookup succeeds; registration INSERT fails
    query.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key violates unique constraint"), {
        code: "23505",
        constraint: "app_user_email_unique",
        detail: "private row value",
      }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "redacted@example.com",
        password: "secretPassword12",
        displayName: "Redacted User",
      }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(query).toHaveBeenCalledTimes(2);
    const params: unknown[] = query.mock.calls[1]![1];
    expect(params).toContain("redacted@example.com");
    const passwordHash = params[1];
    expect(passwordHash).toMatch(/^\$2[ab]\$12\$/);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [label, details] = errorLog.mock.calls[0]!;
    expect(label).toBe("Database query failed");
    expect(details).toEqual({
      query: expect.stringContaining('insert into "app_user"'),
      code: "23505",
      constraint: "app_user_email_unique",
      message: "duplicate key violates unique constraint",
    });
    const serializedLog = JSON.stringify(errorLog.mock.calls);
    expect(serializedLog).not.toContain("redacted@example.com");
    expect(serializedLog).not.toContain("secretPassword12");
    expect(serializedLog).not.toContain(passwordHash);
    expect(serializedLog).not.toContain("private row value");
  });
});

describe("authentication rate limits", () => {
  /** Closes each isolated test server even when a request or assertion fails. */
  async function withRateLimitedApp(env: Record<string, string>, run: (url: string) => Promise<void>) {
    const started = await startAppServer(env);
    try {
      await run(started.base);
    } finally {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  }

  it("shares the per-IP limit across register and login and ignores spoofed forwarding headers", async () => {
    await withRateLimitedApp({ AUTH_RATE_LIMIT_MAX: "1" }, async (url) => {
      const first = await fetch(`${url}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(first.status).toBe(400);

      const second = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.25",
        },
        body: JSON.stringify({ email: "alice@example.com", password: "password" }),
      });
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({
        error: "Too many requests, please try again later.",
      });
      expect(second.headers.get("ratelimit")).toMatch(/"1-in-15min"; r=0; t=\d+/);
      expect(second.headers.get("ratelimit-policy")).toContain("q=1; w=900");
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(Number(second.headers.get("retry-after"))).toBeLessThanOrEqual(900);
      expect(second.headers.has("x-ratelimit-limit")).toBe(false);
      expect(query).not.toHaveBeenCalled();
    });
  });

  it("uses the configured trust-proxy hop count for client IPs", async () => {
    await withRateLimitedApp({ AUTH_RATE_LIMIT_MAX: "1", TRUST_PROXY: "1" }, async (url) => {
      for (const ip of ["198.51.100.25", "198.51.100.26"]) {
        const res = await fetch(`${url}/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ip,
          },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      }
    });
  });

  it("limits normalized email attempts separately for the same IP", async () => {
    query.mockResolvedValue({ rows: [] });
    await withRateLimitedApp({ AUTH_RATE_LIMIT_MAX: "100", LOGIN_RATE_LIMIT_MAX: "1" }, async (url) => {
      const login = (email: string) =>
        fetch(`${url}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "somepassword" }),
        });

      expect((await login(" Alice@Example.com ")).status).toBe(401);
      expect(query).toHaveBeenCalledTimes(1);
      const blocked = await login("alice@example.com");
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ error: "Too many requests, please try again later." });
      expect(blocked.headers.get("ratelimit")).toMatch(/"1-in-15min"; r=0; t=\d+/);
      expect(blocked.headers.get("ratelimit-policy")).toContain("q=1; w=900");
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(900);
      expect(query).toHaveBeenCalledTimes(1);
      expect((await login("bob@example.com")).status).toBe(401);
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps login attempts for the same email separate across client IPs", async () => {
    query.mockResolvedValue({ rows: [] });
    await withRateLimitedApp({ LOGIN_RATE_LIMIT_MAX: "1", TRUST_PROXY: "1" }, async (url) => {
      for (const [ip, status] of [
        ["198.51.100.25", 401],
        ["198.51.100.26", 401],
        ["198.51.100.25", 429],
      ] as const) {
        const res = await fetch(`${url}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
          body: JSON.stringify({ email: "alice@example.com", password: "somepassword" }),
        });
        expect(res.status).toBe(status);
      }
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  it.each(["AUTH_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_MAX"])(
    "groups IPv6 addresses within a /56 subnet for %s",
    async (name) => {
      await withRateLimitedApp({ [name]: "1", TRUST_PROXY: "1" }, async (url) => {
        for (const [ip, status] of [
          ["2001:db8:42:1200::1", 401],
          ["2001:db8:42:12ff::2", 429],
          ["2001:db8:42:1300::1", 401],
        ] as const) {
          const res = await fetch(`${url}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
            body: JSON.stringify({ email: "alice@example.com" }),
          });
          expect(res.status).toBe(status);
        }
        expect(query).not.toHaveBeenCalled();
      });
    },
  );

  it.each(["AUTH_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_MAX"])(
    "rejects invalid %s values at startup",
    async (name) => {
      for (const value of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
        await expect(startAppServer({ [name]: value })).rejects.toThrow(`${name} must be a positive integer`);
      }
    },
  );

  it("rejects invalid proxy hop counts at startup", async () => {
    for (const value of ["-1", "1.5", "true", "9007199254740992"]) {
      await expect(startAppServer({ TRUST_PROXY: value })).rejects.toThrow(
        "TRUST_PROXY must be a non-negative proxy hop count",
      );
    }
  });
});

describe("JSON input errors", () => {
  it.each([
    ["{", 400, "Malformed JSON"],
    [JSON.stringify({ value: "x".repeat(100 * 1024) }), 413, "Request body too large"],
  ])("rejects invalid body %#", async (body, status, error) => {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(query).not.toHaveBeenCalled();
  });
});
