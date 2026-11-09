import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

import {
  clearSessionCookie,
  completePendingSession,
  createSession,
  exchangeGoogleCode,
  getAuthenticatedUserId,
  hashPassword,
  purgeStaleSessions,
  requireAuthenticatedUser,
  requirePendingSession,
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
    cookie: vi.fn((_name, _val, opts) => {
      cookieOptions.push(opts);
    }),
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

/** The transaction runs begin, a user select, the session insert and commit; returns the insert. */
function insertCall() {
  return query.mock.calls.find(([sql]) => String(sql.text ?? sql).startsWith("insert into"))!;
}

describe("createSession", () => {
  it("inserts sha256(token) as token_hash, not the raw token", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const [sql, params] = insertCall();
    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const rawToken: string = cookieMock.mock.calls[0]![1];
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    expect(sql.text).toContain("insert into");
    expect(params).toContain(expectedHash);
    expect(params).not.toContain(rawToken);
  });

  it("sets the cookie with httpOnly, sameSite lax, path /", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    const opts = cookieMock.mock.calls[0]![2];
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("sets secure: false outside production", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock.mock.calls[0]![2].secure).toBe(false);
  });

  it("sets secure: true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { createSession: createSessionProd } = await import("../srcs/auth.ts");

    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSessionProd(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock.mock.calls[0]![2].secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it("sets secure: true outside production when COOKIE_SECURE is true", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    vi.resetModules();
    const { createSession: createSessionBehindHttps } = await import("../srcs/auth.ts");

    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSessionBehindHttps(makeReq(), res, userId);

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock.mock.calls[0]![2].secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it("sets expires ~30 days from now", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    query.mockResolvedValue({ rows: [] });
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

  it("creates a verified 30-day session and returns false when the user has no 2FA", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    expect(await createSession(makeReq(), res, userId)).toBe(false);
    expect(insertCall()[1]).toContainEqual(new Date(Date.now()).toISOString());
  });

  it("creates a pending 10-minute session and returns true when the user has 2FA on", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    query.mockImplementation(async (sql: { text?: string }) => ({
      rows: sql.text?.startsWith("select") ? [[new Date()]] : [],
    }));
    const res = makeRes();
    expect(await createSession(makeReq(), res, userId)).toBe(true);

    const params = insertCall()[1] as unknown[];
    expect(params).toContainEqual(new Date("2025-01-01T00:10:00.000Z").toISOString());
    expect(params).toContain(null); // twofa_verified_at stays null until the code is entered
    const expires: Date = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie.mock.calls[0]![2].expires;
    expect(expires.toISOString()).toBe("2025-01-01T00:10:00.000Z");
  });

  it("rejects and sets no cookie when the INSERT fails", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    const res = makeRes();
    await expect(createSession(makeReq(), res, userId)).rejects.toThrow();

    const cookieMock = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie;
    expect(cookieMock).not.toHaveBeenCalled();
  });

  it("records verified sign-in activity without touching updated_at before issuing the cookie", async () => {
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await createSession(makeReq(), res, userId);
    const [updateSql, updateParams] = query.mock.calls.find(([config]) =>
      config.text?.startsWith('update "app_user"'),
    )!;
    expect(updateSql.text).toContain('update "app_user" set "last_active_at"');
    expect(updateSql.text).toContain('"last_active_at" <');
    expect(updateSql.text).not.toContain('"updated_at"');
    expect(updateParams).toContain(userId);
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it("issues a cookie even if recording sign-in activity fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockImplementation(async (config: { text?: string }) => {
      if (config.text?.startsWith('update "app_user"')) throw new Error("DB down");
      return { rows: [] };
    });
    const res = makeRes();
    expect(await createSession(makeReq(), res, userId)).toBe(false);
    expect(res.cookie).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("Failed to record user activity:", expect.any(Error));
  });

  it("does not record presence when sign-in still requires a second factor", async () => {
    query.mockImplementation(async (config: { text?: string }) => ({
      rows: config.text?.startsWith("select") ? [[new Date()]] : [],
    }));
    expect(await createSession(makeReq(), makeRes(), userId)).toBe(true);
    expect(query.mock.calls.some(([config]) => config.text?.startsWith('update "app_user"'))).toBe(false);
  });
});

// ─── clearSessionCookie ───────────────────────────────────────────────────────

describe("clearSessionCookie", () => {
  it("clears the session cookie with the same options used by createSession", () => {
    const res = makeRes();
    clearSessionCookie(res);

    const clearMock = (res as unknown as { clearCookie: ReturnType<typeof vi.fn> }).clearCookie;
    expect(clearMock).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );
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
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
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

  it("joins appUsers and checks expires_at and revoked_at", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ cookies: { session: "tok" } });
    await getAuthenticatedUserId(req);

    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain("inner join");
    expect(sql).toContain('"session"."expires_at"');
    expect(sql).toContain('"session"."revoked_at"');
  });

  it("rejects pending sessions (twofa_verified_at is null)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getAuthenticatedUserId(makeReq({ cookies: { session: "tok" } }));

    expect(query.mock.calls[0]![0].text).toContain('"session"."twofa_verified_at" is not null');
  });

  it("throttles verified activity at the one-minute boundary", async () => {
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const req = makeReq({ cookies: { session: "valid-token" } });
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date("2026-01-01T11:59:00Z")]] });
    expect(await getAuthenticatedUserId(req)).toBe(userId);
    expect(query).toHaveBeenCalledTimes(1);

    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date("2026-01-01T11:58:59.999Z")]] });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getAuthenticatedUserId(req)).toBe(userId);
    const [updateSql, updateParams] = query.mock.calls[2]!;
    expect(updateSql.text).toContain('"last_active_at" <');
    expect(updateSql.text).not.toContain('"updated_at"');
    expect(updateParams).toContain("2026-01-01T11:59:00.000Z");
  });

  it("returns the authenticated user when updating presence fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", null]] });
    query.mockRejectedValueOnce(new Error("DB down"));

    expect(await getAuthenticatedUserId(makeReq({ cookies: { session: "valid-token" } }))).toBe(userId);
    expect(query).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith("Failed to record user activity:", expect.any(Error));
  });

  it("never records activity for an invalid session", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getAuthenticatedUserId(makeReq({ cookies: { session: "invalid" } }))).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

// ─── requirePendingSession ────────────────────────────────────────────────────

describe("requirePendingSession", () => {
  it("accepts only sessions whose twofa_verified_at is null", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id"]] });
    const res = makeRes();
    const next = vi.fn();
    await requirePendingSession(makeReq({ cookies: { session: "tok" } }), res, next);

    expect(query.mock.calls[0]![0].text).toContain('"session"."twofa_verified_at" is null');
    expect(res.locals).toMatchObject({ userId, sessionId: "session-id" });
    expect(next).toHaveBeenCalledWith();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without a pending session", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    const next = vi.fn();
    await requirePendingSession(makeReq({ cookies: { session: "tok" } }), res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── completePendingSession ───────────────────────────────────────────────────

describe("completePendingSession", () => {
  it("verifies the session, extends it to 30 days and re-sets the same token", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await completePendingSession(makeReq({ cookies: { session: "pending-token" } }), res, "session-id", userId);

    expect(query.mock.calls[0]![0].text).toContain('"twofa_verified_at" = ');
    expect(query.mock.calls[1]![0].text).toContain('"last_active_at"');
    const [, token, options] = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie.mock.calls[0]!;
    expect(token).toBe("pending-token");
    expect(options.expires.toISOString()).toBe("2025-01-31T00:00:00.000Z");
  });

  it("finishes two-factor authentication when updating presence fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockResolvedValueOnce({ rows: [] });
    query.mockRejectedValueOnce(new Error("DB down"));
    const res = makeRes();

    await completePendingSession(makeReq({ cookies: { session: "pending-token" } }), res, "session-id", userId);

    expect(res.cookie).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("Failed to record user activity:", expect.any(Error));
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
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    const req = makeReq({ cookies: { session: "valid-token" } });
    const res = makeRes();
    const next = vi.fn();
    await requireAuthenticatedUser(req, res, next);

    expect(res.locals.userId).toBe(userId);
    expect(res.locals.sessionId).toBe("session-id");
    expect(next).toHaveBeenCalledWith();
  });

  it("allows protected requests even when updating presence fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", null]] });
    query.mockRejectedValueOnce(new Error("DB down"));
    const res = makeRes();
    const next = vi.fn();

    await requireAuthenticatedUser(makeReq({ cookies: { session: "valid-token" } }), res, next);

    expect(res.locals).toMatchObject({ userId, sessionId: "session-id" });
    expect(next).toHaveBeenCalledWith();
    expect(errorLog).toHaveBeenCalledWith("Failed to record user activity:", expect.any(Error));
  });

  it("rejects when the session query fails", async () => {
    const error = new Error("DB down");
    query.mockRejectedValueOnce(error);
    const req = makeReq({ cookies: { session: "tok" } });
    const res = makeRes();
    const next = vi.fn();
    await expect(requireAuthenticatedUser(req, res, next)).rejects.toMatchObject({ cause: { message: "DB down" } });
    expect(next).not.toHaveBeenCalled();
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

describe("purgeStaleSessions", () => {
  it("deletes only sessions expired or revoked before the seven-day cutoff", async () => {
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    query.mockResolvedValueOnce({ rows: [], rowCount: 2 });

    expect(await purgeStaleSessions()).toBe(2);

    const [sql, params] = query.mock.calls[0]!;
    expect(sql.text).toMatch(/delete from "session" where \(.*"expires_at" < \$1 or .*"revoked_at" < \$2\)/);
    expect(params).toEqual(["2026-09-28T12:00:00.000Z", "2026-09-28T12:00:00.000Z"]);
  });

  it("returns zero when no sessions are stale", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await purgeStaleSessions()).toBe(0);
  });

  it("rejects when deletion fails", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(purgeStaleSessions()).rejects.toMatchObject({ cause: { message: "DB down" } });
  });
});

describe("exchangeGoogleCode", () => {
  const clientId = "client-id.apps.googleusercontent.com";
  const validClaims = {
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: "google-sub-1",
    email: "Alice@Example.com",
    email_verified: true,
    name: "Alice",
  };

  function respondWith(claims: Record<string, unknown>, ok = true) {
    const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => ({ id_token: idToken }) }));
  }

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the Google account with a lowercased email and sends the PKCE verifier", async () => {
    respondWith(validClaims);
    expect(await exchangeGoogleCode("code", "verifier", "http://localhost:3000/auth/google")).toEqual({
      sub: "google-sub-1",
      email: "alice@example.com",
      name: "Alice",
    });
    const body = vi.mocked(fetch).mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("redirect_uri")).toBe("http://localhost:3000/auth/google");
  });

  it.each([
    ["an unverified Google email", { email_verified: false }],
    ["another client's token", { aud: "other-client" }],
    ["another issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 1 }],
  ])("rejects %s", async (_label, override) => {
    respondWith({ ...validClaims, ...override });
    expect(await exchangeGoogleCode("code", "verifier", "uri")).toBeUndefined();
  });

  it("rejects a code Google refuses", async () => {
    respondWith(validClaims, false);
    expect(await exchangeGoogleCode("code", "verifier", "uri")).toBeUndefined();
  });

  it("throws when the Google client is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    await expect(exchangeGoogleCode("code", "verifier", "uri")).rejects.toThrow("GOOGLE_CLIENT_ID");
  });
});
