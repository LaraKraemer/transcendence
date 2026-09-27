import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

import {
  clearSessionCookie,
  createSession,
  getAuthenticatedUserId,
  hashPassword,
  requireAuthenticatedUser,
  revokeCurrentSession,
  verifyPassword,
} from "../srcs/auth.ts";

const userId = "550e8400-e29b-41d4-a716-446655440001";

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    cookies: {},
    ip: "127.0.0.1",
    get: (name: string) => (name === "user-agent" ? "test-agent" : undefined),
    ...overrides,
  } as unknown as import("express").Request;
}

function makeRes() {
  const cookieOptions: Record<string, unknown>[] = [];
  return {
    locals: {},
    cookie: vi.fn((_name, _val, opts) => { cookieOptions.push(opts); }),
    clearCookie: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    _cookieOptions: cookieOptions,
  } as unknown as import("express").Response & { _cookieOptions: Record<string, unknown>[] };
}

beforeEach(() => {
  query.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

// ─── hashPassword / verifyPassword ───────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("produces a bcrypt hash, not the raw password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(hash).toMatch(/^\$2[aby]\$/);
  }, 15_000);

  it("uses cost factor 12", async () => {
    const hash = await hashPassword("correct-horse-battery");
    const { getRounds } = await import("bcryptjs");
    expect(getRounds(hash)).toBe(12);
  }, 15_000);

  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
  }, 15_000);

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  }, 15_000);
});

// ─── createSession ────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("inserts sha256(token) as token_hash, not the raw token", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const [sql, params] = query.mock.calls[0]!;
    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const rawToken: string = cookieMock.mock.calls[0]![1];
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    expect(sql.text).toContain("insert into");
    expect(params).toContain(expectedHash);
    expect(params).not.toContain(rawToken);
  });

  it("sets the cookie with httpOnly, sameSite lax, path /", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const opts = cookieMock.mock.calls[0]![2];
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("sets secure: false outside production", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock.mock.calls[0]![2].secure).toBe(false);
  });

  it("sets secure: true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { createSession: createSessionProd } = await import("../srcs/auth.ts");

    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createSessionProd(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock.mock.calls[0]![2].secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it("sets expires ~30 days from now", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const expires: Date = cookieMock.mock.calls[0]![2].expires;
    const expectedMs = new Date("2025-01-01T00:00:00.000Z").getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBe(expectedMs);
  });

  it("generates a 43-character base64url token that differs between calls", async () => {
    query.mockResolvedValue({ rows: [] });
    const res1 = makeRes();
    const res2 = makeRes();
    await createSession(makeReq(), res1, userId);
    await createSession(makeReq(), res2, userId);

    const cookie1 = (res1 as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const cookie2 = (res2 as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const t1: string = cookie1.mock.calls[0]![1];
    const t2: string = cookie2.mock.calls[0]![1];

    expect(t1).toHaveLength(43);
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t1).not.toBe(t2);
  });

  it("rejects and sets no cookie when the INSERT fails", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    const res = makeRes();
    await expect(createSession(makeReq(), res, userId)).rejects.toThrow();

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock).not.toHaveBeenCalled();
  });
});

// ─── clearSessionCookie ───────────────────────────────────────────────────────

describe("clearSessionCookie", () => {
  it("clears the session cookie with the same options used by createSession", () => {
    const res = makeRes();
    clearSessionCookie(res);

    const clearMock = (res as unknown as { clearCookie: ReturnType<typeof vi.fn> }).clearCookie;
    expect(clearMock).toHaveBeenCalledWith("session", expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    }));
  });
});

// ─── getAuthenticatedUserId ───────────────────────────────────────────────────

describe("getAuthenticatedUserId", () => {
  it("returns undefined when there is no cookie", async () => {
    expect(await getAuthenticatedUserId(makeReq())).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns undefined when req.cookies is undefined", async () => {
    const req = makeReq({ cookies: undefined });
    expect(await getAuthenticatedUserId(req)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns undefined when the cookie is not a string (parsed object)", async () => {
    const req = makeReq({ cookies: { session: { parsed: true } } });
    expect(await getAuthenticatedUserId(req)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the userId when the session lookup returns a row", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    const req = makeReq({ cookies: { session: "some-token" } });
    expect(await getAuthenticatedUserId(req)).toBe(userId);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the session lookup returns no row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ cookies: { session: "some-token" } });
    expect(await getAuthenticatedUserId(req)).toBeUndefined();
  });

  it("queries with sha256(token), not the raw token", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const token = "my-raw-token";
    const req = makeReq({ cookies: { session: token } });
    await getAuthenticatedUserId(req);

    const [, params] = query.mock.calls[0]!;
    const hash = createHash("sha256").update(token).digest("hex");
    expect(params).toContain(hash);
    expect(params).not.toContain(token);
  });

  it("joins appUsers and checks expires_at, revoked_at and deleted_at", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ cookies: { session: "tok" } });
    await getAuthenticatedUserId(req);

    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain("inner join");
    expect(sql).toContain('"session"."expires_at"');
    expect(sql).toContain('"session"."revoked_at"');
    expect(sql).toContain('"app_user"."deleted_at"');
  });
});

// ─── requireAuthenticatedUser ─────────────────────────────────────────────────

describe("requireAuthenticatedUser", () => {
  it("returns 401 and does not call next when there is no session", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await requireAuthenticatedUser(req, res, next);

    const statusMock = (res as unknown as { status: ReturnType<typeof vi.fn> }).status;
    const jsonMock = (res as unknown as { json: ReturnType<typeof vi.fn> }).json;
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets res.locals.userId and calls next() with a valid session", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    const req = makeReq({ cookies: { session: "valid-token" } });
    const res = makeRes();
    const next = vi.fn();
    await requireAuthenticatedUser(req, res, next);

    expect(res.locals.userId).toBe(userId);
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(error) when the session query fails", async () => {
    const error = new Error("DB down");
    query.mockRejectedValueOnce(error);
    const req = makeReq({ cookies: { session: "tok" } });
    const res = makeRes();
    const next = vi.fn();
    await requireAuthenticatedUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── revokeCurrentSession ─────────────────────────────────────────────────────

describe("revokeCurrentSession", () => {
  it("runs no query when there is no cookie", async () => {
    await revokeCurrentSession(makeReq());
    expect(query).not.toHaveBeenCalled();
  });

  it("updates revoked_at where token_hash matches and revoked_at is null", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const token = "my-session-token";
    const req = makeReq({ cookies: { session: token } });
    await revokeCurrentSession(req);

    const [sql, params] = query.mock.calls[0]!;
    const hash = createHash("sha256").update(token).digest("hex");
    expect(sql.text).toContain('"revoked_at"');
    expect(params).toContain(hash);
  });
});
