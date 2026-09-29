import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

// Mock auth helpers to keep bcrypt out of these tests.
const authMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  clearSessionCookie: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  revokeCurrentSession: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("../../srcs/auth.ts", () => ({
  createSession: authMocks.createSession,
  clearSessionCookie: authMocks.clearSessionCookie,
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
  revokeCurrentSession: authMocks.revokeCurrentSession,
  hashPassword: authMocks.hashPassword,
  verifyPassword: authMocks.verifyPassword,
}));

import { authRouter } from "../../srcs/routes/auth.ts";
import { dispatch } from "../helpers/dispatch.ts";

const userId = "550e8400-e29b-41d4-a716-446655440001";

// appUsers select * row order: id, email, passwordHash, displayName, avatarUrl,
// emailVerifiedAt, passwordChangedAt, createdAt, updatedAt, deletedAt
function userRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? userId,
    overrides.email ?? "alice@example.com",
    overrides.passwordHash ?? "$2b$12$hashed",
    overrides.displayName ?? "Alice",
    null, // avatarUrl
    null, // emailVerifiedAt
    new Date().toISOString(), // passwordChangedAt
    new Date().toISOString(), // createdAt
    new Date().toISOString(), // updatedAt
    null, // deletedAt
  ];
}

// returning({ id, email, displayName }) row
function createdUserRow(overrides: Record<string, unknown> = {}) {
  return [overrides.id ?? userId, overrides.email ?? "alice@example.com", overrides.displayName ?? "Alice"];
}

beforeEach(() => {
  query.mockReset();
  vi.resetAllMocks();
  authMocks.hashPassword.mockResolvedValue("$2b$12$hashed");
  authMocks.createSession.mockResolvedValue(undefined);
  authMocks.revokeCurrentSession.mockResolvedValue(undefined);
  authMocks.clearSessionCookie.mockReturnValue(undefined);
  authMocks.verifyPassword.mockResolvedValue(true);
  authMocks.getAuthenticatedUserId.mockResolvedValue(undefined);
});

// ─── POST /register ───────────────────────────────────────────────────────────

describe("POST /register", () => {
  function register(body: unknown) {
    return dispatch(authRouter, { method: "POST", url: "/register", body });
  }

  it.each([
    [undefined, "A valid email is required"],
    [123, "A valid email is required"],
    ["not-an-email", "A valid email is required"],
    ["a@b", "A valid email is required"],
    ["  @example.com", "A valid email is required"],
  ])("rejects invalid email %j", async (email, errorMsg) => {
    const result = await register({ email, password: "validpassword12", displayName: "Alice" });
    expect(result).toEqual({ status: 400, body: { error: errorMsg } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "Password must be 12 to 72 bytes"],
    [12345, "Password must be 12 to 72 bytes"],
    ["tooshort11", "Password must be 12 to 72 bytes"], // 11 chars
    ["é".repeat(37), "Password must be 12 to 72 bytes"], // 74 bytes
  ])("rejects invalid password %j", async (password, errorMsg) => {
    const result = await register({ email: "alice@example.com", password, displayName: "Alice" });
    expect(result).toEqual({ status: 400, body: { error: errorMsg } });
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts a 12-character password", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail → not found
    query.mockResolvedValueOnce({ rows: [createdUserRow()] }); // createUser
    const result = await register({
      email: "alice@example.com",
      password: "12characters",
      displayName: "Alice",
    });
    expect(result.status).toBe(201);
  });

  it("accepts a 72-byte password", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [createdUserRow()] });
    const result = await register({
      email: "alice@example.com",
      password: "a".repeat(72),
      displayName: "Alice",
    });
    expect(result.status).toBe(201);
  });

  it.each([
    [undefined, "displayName must be between 1 and 100 characters"],
    ["   ", "displayName must be between 1 and 100 characters"],
    ["a".repeat(101), "displayName must be between 1 and 100 characters"],
  ])("rejects invalid displayName %j", async (displayName, errorMsg) => {
    const result = await register({
      email: "alice@example.com",
      password: "validpassword12",
      displayName,
    });
    expect(result).toEqual({ status: 400, body: { error: errorMsg } });
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts a 100-character displayName", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [createdUserRow()] });
    const result = await register({
      email: "alice@example.com",
      password: "validpassword12",
      displayName: "a".repeat(100),
    });
    expect(result.status).toBe(201);
  });

  it("returns 400 with no request body", async () => {
    const result = await register(undefined);
    expect(result.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("normalises email: trims and lowercases for duplicate check and INSERT", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [createdUserRow({ email: "alice@example.com" })] }); // createUser

    await register({
      email: "  Alice@Example.COM ",
      password: "validpassword12",
      displayName: "Alice",
    });

    const lookupParams: unknown[] = query.mock.calls[0]![1];
    expect(lookupParams).toContain("alice@example.com");
    const insertParams: unknown[] = query.mock.calls[1]![1];
    expect(insertParams).toContain("alice@example.com");
  });

  it("returns 409 when the email already exists, no INSERT, no session", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] }); // findUserByEmail → found

    const result = await register({
      email: "alice@example.com",
      password: "validpassword12",
      displayName: "Alice",
    });

    expect(result).toEqual({
      status: 409,
      body: { error: "An account with this email already exists" },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 201 with user, calls hashPassword and createSession", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [createdUserRow()] }); // createUser

    const result = await register({
      email: "alice@example.com",
      password: "validpassword12",
      displayName: "Alice",
    });

    expect(result.status).toBe(201);
    expect((result.body as { user: unknown }).user).toBeDefined();
    expect(authMocks.hashPassword).toHaveBeenCalledWith("validpassword12");
    expect(authMocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("stores the hashed password, not the raw password, in the INSERT", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [createdUserRow()] }); // createUser

    await register({
      email: "alice@example.com",
      password: "validpassword12",
      displayName: "Alice",
    });

    const insertParams: unknown[] = query.mock.calls[1]![1];
    expect(insertParams).toContain("$2b$12$hashed");
    expect(insertParams).not.toContain("validpassword12");
  });

  it("forwards createUser returning no row as an error", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [] }); // createUser returns empty

    await expect(
      dispatch(authRouter, {
        method: "POST",
        url: "/register",
        body: { email: "alice@example.com", password: "validpassword12", displayName: "Alice" },
      }),
    ).rejects.toThrow();
  });

  it("forwards database errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      register({ email: "alice@example.com", password: "validpassword12", displayName: "Alice" }),
    ).rejects.toThrow();
  });
});

// ─── POST /login ──────────────────────────────────────────────────────────────

describe("POST /login", () => {
  function login(body: unknown) {
    return dispatch(authRouter, { method: "POST", url: "/login", body });
  }

  it("returns 401 with missing email, no query", async () => {
    const result = await login({ password: "somepassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 401 with non-string password, no query", async () => {
    const result = await login({ email: "alice@example.com", password: 12345 });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("normalises email and excludes soft-deleted users in the lookup", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // user not found
    await login({ email: "  Alice@Example.COM ", password: "somepassword" });

    const lookupParams: unknown[] = query.mock.calls[0]![1];
    expect(lookupParams).toContain("alice@example.com");
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toMatch(/"deleted_at" is null/i);
  });

  it("returns 401 for unknown email, no session", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await login({ email: "nobody@example.com", password: "somepassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 401 for wrong password, no session", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] });
    authMocks.verifyPassword.mockResolvedValueOnce(false);
    const result = await login({ email: "alice@example.com", password: "wrongpassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 200 with user on success, calls createSession, no passwordHash", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] });
    const result = await login({ email: "alice@example.com", password: "correctpassword" });

    expect(result.status).toBe(200);
    const body = result.body as { user: Record<string, unknown> };
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.id).toBe(userId);
    expect(authMocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
  });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

describe("POST /logout", () => {
  it("calls revokeCurrentSession and clearSessionCookie, returns 204", async () => {
    const result = await dispatch(authRouter, { method: "POST", url: "/logout" });
    expect(result.status).toBe(204);
    expect(authMocks.revokeCurrentSession).toHaveBeenCalledTimes(1);
    expect(authMocks.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("forwards errors from revokeCurrentSession", async () => {
    authMocks.revokeCurrentSession.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(authRouter, { method: "POST", url: "/logout" })).rejects.toThrow();
  });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

describe("GET /me", () => {
  it("returns 401 without a session, no user query", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(undefined);
    const result = await dispatch(authRouter, { method: "GET", url: "/me" });
    expect(result).toEqual({ status: 401, body: { error: "Authentication required" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 200 with user, select does not include password_hash", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
    // findUserById returns { id, email, displayName }
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice"]] });

    const result = await dispatch(authRouter, { method: "GET", url: "/me" });

    expect(result.status).toBe(200);
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).not.toContain("password_hash");
  });

  it("forwards database errors", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(authRouter, { method: "GET", url: "/me" })).rejects.toThrow();
  });
});
