import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

// Mock storage to keep file I/O out of unit tests.
const storageMocks = vi.hoisted(() => ({
  writeAvatar: vi.fn(),
  readAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  avatarDir: vi.fn().mockReturnValue("/tmp/avatars"),
}));
vi.mock("../../srcs/storage.ts", () => storageMocks);

// Mock auth helpers to keep bcrypt out of these tests.
const authMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  completePendingSession: vi.fn(),
  clearSessionCookie: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  revokeCurrentSession: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("$2b$12$dummy"),
  verifyPassword: vi.fn(),
}));
vi.mock("../../srcs/auth.ts", async (importOriginal) => ({
  requireAuthenticatedUser: (await importOriginal<typeof import("../../srcs/auth.ts")>()).requireAuthenticatedUser,
  requirePendingSession: (await importOriginal<typeof import("../../srcs/auth.ts")>()).requirePendingSession,
  createSession: authMocks.createSession,
  completePendingSession: authMocks.completePendingSession,
  clearSessionCookie: authMocks.clearSessionCookie,
  exchangeGoogleCode: authMocks.exchangeGoogleCode,
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
  revokeCurrentSession: authMocks.revokeCurrentSession,
  hashPassword: authMocks.hashPassword,
  verifyPassword: authMocks.verifyPassword,
}));

import { logins, usersRegistered } from "../../srcs/metrics.ts";
import { authRouter } from "../../srcs/routes/auth.ts";
import { encryptSecret, generateSecret, hashRecoveryCode, totpCode, currentStep } from "../../srcs/totp.ts";
import { dispatch } from "../helpers/dispatch.ts";

const userId = "550e8400-e29b-41d4-a716-446655440001";

// appUsers select * row order: id, email, passwordHash, displayName, avatarUrl,
// emailVerifiedAt, lastActiveAt, passwordChangedAt, totpSecretEncrypted,
// totpEnabledAt, totpLastUsedStep, createdAt, updatedAt
function userRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? userId,
    overrides.email ?? "alice@example.com",
    "passwordHash" in overrides ? overrides.passwordHash : "$2b$12$hashed",
    overrides.displayName ?? "Alice",
    null, // avatarUrl
    overrides.emailVerifiedAt ?? null,
    null, // lastActiveAt
    new Date().toISOString(), // passwordChangedAt
    null, // totpSecretEncrypted
    null, // totpEnabledAt
    null, // totpLastUsedStep
    new Date().toISOString(), // createdAt
    new Date().toISOString(), // updatedAt
  ];
}

// returning({ id, email, displayName }) row
function createdUserRow(overrides: Record<string, unknown> = {}) {
  return [overrides.id ?? userId, overrides.email ?? "alice@example.com", overrides.displayName ?? "Alice"];
}

beforeEach(() => {
  usersRegistered.reset();
  logins.reset();
  query.mockReset();
  vi.resetAllMocks();
  authMocks.hashPassword.mockResolvedValue("$2b$12$hashed");
  authMocks.createSession.mockResolvedValue(undefined);
  authMocks.revokeCurrentSession.mockResolvedValue(undefined);
  authMocks.clearSessionCookie.mockReturnValue(undefined);
  authMocks.verifyPassword.mockResolvedValue(true);
  authMocks.getAuthenticatedUserId.mockResolvedValue(undefined);
  storageMocks.writeAvatar.mockResolvedValue(undefined);
  storageMocks.deleteAvatar.mockResolvedValue(undefined);
  storageMocks.avatarDir.mockReturnValue("/tmp/avatars");
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
    [`${"a".repeat(250)}@b.co`, "A valid email is required"], // 255 characters
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
    expect((await usersRegistered.get()).values[0]?.value).toBe(1);
    expect((await logins.get()).values).toEqual([]);
    expect(result.body).toEqual({
      user: { id: userId, email: "alice@example.com", displayName: "Alice", avatarUrl: null },
    });
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

  it("normalises email in the lookup", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // user not found
    await login({ email: "  Alice@Example.COM ", password: "somepassword" });

    const lookupParams: unknown[] = query.mock.calls[0]![1];
    expect(lookupParams).toContain("alice@example.com");
  });

  it("returns 401 for unknown email, no session", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await login({ email: "nobody@example.com", password: "somepassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect((await logins.get()).values).toContainEqual({ value: 1, labels: { result: "failure" } });
    expect(authMocks.verifyPassword).toHaveBeenCalledWith("somepassword", "$2b$12$dummy");
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 401 for a Google-only account without a password", async () => {
    query.mockResolvedValueOnce({ rows: [userRow({ passwordHash: null })] });
    const result = await login({ email: "alice@example.com", password: "somepassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(authMocks.verifyPassword).toHaveBeenCalledWith("somepassword", "$2b$12$dummy");
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 401 for wrong password, no session", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] });
    authMocks.verifyPassword.mockResolvedValueOnce(false);
    const result = await login({ email: "alice@example.com", password: "wrongpassword" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid email or password" } });
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns only twoFactorRequired, no user data, when the session is pending a 2FA code", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] });
    authMocks.createSession.mockResolvedValueOnce(true);
    const result = await login({ email: "alice@example.com", password: "correctpassword" });
    expect(result).toEqual({ status: 200, body: { twoFactorRequired: true } });
    expect((await logins.get()).values).toEqual([]);
  });

  it("returns 200 with user on success, calls createSession, no passwordHash", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()] });
    const result = await login({ email: "alice@example.com", password: "correctpassword" });

    expect(result.status).toBe(200);
    expect((await logins.get()).values).toContainEqual({ value: 1, labels: { result: "success" } });
    const body = result.body as { user: Record<string, unknown> };
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.id).toBe(userId);
    expect(body.user.avatarUrl).toBeNull();
    expect(authMocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
  });
});

// ─── POST /google ─────────────────────────────────────────────────────────────

describe("POST /google", () => {
  const googleBody = { code: "auth-code", codeVerifier: "verifier", redirectUri: "http://localhost:3000/auth/google" };
  const googleUser = { sub: "google-sub-1", email: "alice@example.com", name: "Alice G" };
  const emailTaken = { status: 409, body: { error: "An account with this email already exists" } };

  function signInWithGoogle(body: unknown = googleBody) {
    return dispatch(authRouter, { method: "POST", url: "/google", body });
  }

  function insertedSql() {
    return query.mock.calls
      .map(([config]) => (config as { text: string }).text)
      .filter((sql) => sql.startsWith("insert"));
  }

  it("rejects a body without code, codeVerifier and redirectUri", async () => {
    const result = await signInWithGoogle({ code: "auth-code" });
    expect(result).toEqual({ status: 400, body: { error: "code, codeVerifier and redirectUri must be strings" } });
    expect(authMocks.exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("returns 401 when Google rejects the code or the Google email is unverified", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(undefined);
    expect(await signInWithGoogle()).toEqual({ status: 401, body: { error: "Google sign-in failed" } });
    expect(authMocks.exchangeGoogleCode).toHaveBeenCalledWith("auth-code", "verifier", googleBody.redirectUri);
    expect((await logins.get()).values).toContainEqual({ value: 1, labels: { result: "failure" } });
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("signs in the user already linked to this Google account", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", null]] }); // findUserByIdentity
    const result = await signInWithGoogle();
    expect(result).toEqual({
      status: 200,
      body: { user: { id: userId, email: "alice@example.com", displayName: "Alice", avatarUrl: null } },
    });
    expect(authMocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
    expect((await logins.get()).values).toContainEqual({ value: 1, labels: { result: "success" } });
    expect((await usersRegistered.get()).values[0]?.value).toBe(0);
  });

  it("keeps Google login pending without counting success when 2FA is required", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", null]] });
    authMocks.createSession.mockResolvedValueOnce(true);
    expect(await signInWithGoogle()).toEqual({ status: 200, body: { twoFactorRequired: true } });
    expect((await logins.get()).values).toEqual([]);
  });

  it("links an existing account whose email is verified", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [] }); // findUserByIdentity
    query.mockResolvedValueOnce({ rows: [userRow({ emailVerifiedAt: new Date().toISOString() })] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [["identity-id"]] }); // linkIdentity
    const result = await signInWithGoogle();
    expect(result.status).toBe(200);
    expect(insertedSql()).toEqual([expect.stringContaining('insert into "user_identity"')]);
    expect(query.mock.calls.at(-1)![1]).toEqual([userId, "google", "google-sub-1"]);
    expect(authMocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
  });

  it("returns 409 email taken and links nothing when the existing account's email is unverified", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [] }); // findUserByIdentity
    query.mockResolvedValueOnce({ rows: [userRow()] }); // findUserByEmail, emailVerifiedAt null
    expect(await signInWithGoogle()).toEqual(emailTaken);
    expect(insertedSql()).toEqual([]);
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 409 when the verified account is already linked to another Google account", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [] }); // findUserByIdentity
    query.mockResolvedValueOnce({ rows: [userRow({ emailVerifiedAt: new Date().toISOString() })] });
    query.mockResolvedValueOnce({ rows: [] }); // linkIdentity hits user_identity_user_provider_unique
    expect(await signInWithGoogle()).toEqual(emailTaken);
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it("creates a verified passwordless user and its Google identity for a new email", async () => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce(googleUser);
    query.mockResolvedValueOnce({ rows: [] }); // findUserByIdentity
    query.mockResolvedValueOnce({ rows: [] }); // findUserByEmail
    query.mockResolvedValueOnce({ rows: [] }); // begin
    query.mockResolvedValueOnce({ rows: [createdUserRow({ displayName: "Alice G" })] }); // insert app_user
    query.mockResolvedValueOnce({ rows: [] }); // insert user_identity
    query.mockResolvedValueOnce({ rows: [] }); // commit
    const result = await signInWithGoogle();
    expect(result).toEqual({
      status: 201,
      body: { user: { id: userId, email: "alice@example.com", displayName: "Alice G", avatarUrl: null } },
    });
    const [userInsert, identityInsert] = query.mock.calls.filter(([config]) =>
      (config as { text: string }).text.startsWith("insert"),
    );
    // No password hash is bound; the third value is email_verified_at.
    expect(userInsert![1]).toEqual(["alice@example.com", "Alice G", expect.any(String)]);
    expect(identityInsert![1]).toEqual([userId, "google", "google-sub-1"]);
    expect((await usersRegistered.get()).values[0]?.value).toBe(1);
    expect((await logins.get()).values).toEqual([]);
    expect(authMocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), userId);
  });
});

describe("Google registration metrics", () => {
  it.each(["identity insert", "commit"])("does not count a registration when %s fails", async (failure) => {
    authMocks.exchangeGoogleCode.mockResolvedValueOnce({ sub: "google-sub-1", email: "new@example.com" });
    query
      .mockResolvedValueOnce({ rows: [] }) // identity lookup
      .mockResolvedValueOnce({ rows: [] }) // email lookup
      .mockResolvedValueOnce({ rows: [] }) // begin
      .mockResolvedValueOnce({ rows: [createdUserRow()] });
    if (failure === "commit") query.mockResolvedValueOnce({ rows: [] });
    query.mockRejectedValueOnce(new Error("database failure")).mockResolvedValueOnce({ rows: [] }); // rollback
    await expect(
      dispatch(authRouter, {
        method: "POST",
        url: "/google",
        body: { code: "code", codeVerifier: "verifier", redirectUri: "http://localhost:3000/auth/google" },
      }),
    ).rejects.toThrow();
    expect((await usersRegistered.get()).values[0]?.value).toBe(0);
    expect(authMocks.createSession).not.toHaveBeenCalled();
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

  it.each([true, false])(
    "returns 200 with hasPassword and twoFactorEnabled but never the hash (%s)",
    async (hasPassword) => {
      authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
      // findUserById returns { id, email, displayName, avatarUrl, hasPassword, twoFactorEnabled }
      query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", null, hasPassword, true]] });

      const result = await dispatch(authRouter, { method: "GET", url: "/me" });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        user: {
          id: userId,
          email: "alice@example.com",
          displayName: "Alice",
          avatarUrl: null,
          hasPassword,
          twoFactorEnabled: true,
        },
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![0].text).not.toMatch(/"password_hash",/);
    },
  );

  it("exposes the avatar route instead of the storage key", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", "secret-key.png", true]] });
    const result = await dispatch(authRouter, { method: "GET", url: "/me" });
    const { avatarUrl } = (result.body as { user: { avatarUrl: string } }).user;
    expect(avatarUrl).toMatch(/^\/auth\/me\/avatar\?v=[0-9a-f]{16}$/);
    expect(avatarUrl).not.toContain("secret-key");
  });

  it("changes the avatar version with the stored file, not with the user", async () => {
    const versionFor = async (key: string) => {
      authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
      query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", key, true]] });
      const result = await dispatch(authRouter, { method: "GET", url: "/me" });
      return (result.body as { user: { avatarUrl: string } }).user.avatarUrl;
    };
    const first = await versionFor("first.png");
    expect(await versionFor("first.png")).toBe(first);
    expect(await versionFor("second.png")).not.toBe(first);
  });

  it("forwards database errors", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(authRouter, { method: "GET", url: "/me" })).rejects.toThrow();
  });
});

describe("DELETE /me", () => {
  const remove = (cookies = {}) =>
    dispatch(authRouter, { method: "DELETE", url: "/me", cookies, body: { userId: "another-user" } });

  it("requires a valid session", async () => {
    expect((await remove()).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce({ rows: [] });
    expect((await remove({ session: "invalid" })).status).toBe(401);
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user and clears the session cookie", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow()] }); // findUserById
    query.mockResolvedValueOnce({ rows: [] });
    expect(await remove({ session: "valid" })).toEqual({ status: 204, body: undefined });
    expect(query.mock.calls[2]![0].text).toMatch(/^delete from "app_user" where "app_user"\."id" = \$1$/);
    expect(query.mock.calls[2]![1]).toEqual([userId]);
    expect(authMocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(storageMocks.deleteAvatar).not.toHaveBeenCalled();
  });

  it("removes the avatar file once the user is deleted", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] });
    query.mockResolvedValueOnce({ rows: [] });
    await remove({ session: "valid" });
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("photo.jpg");
  });

  it("forwards deletion failures without clearing the cookie", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] });
    query.mockRejectedValueOnce(new Error("Deletion failed"));
    await expect(remove({ session: "valid" })).rejects.toThrow();
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
    expect(storageMocks.deleteAvatar).not.toHaveBeenCalled();
  });
});

describe("PATCH /password", () => {
  const body = { currentPassword: "old-password12", newPassword: "new-password12" };
  const change = (value: unknown = body) =>
    dispatch(authRouter, {
      method: "PATCH",
      url: "/password",
      body: value,
      cookies: { session: "token" },
    });
  function prepare() {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [["old-hash"]] });
    query.mockResolvedValueOnce({ rows: [] }); // begin
  }

  it("requires authentication", async () => {
    expect((await dispatch(authRouter, { method: "PATCH", url: "/password", body })).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { newPassword: "new-password12" },
    { currentPassword: "old-password12" },
    { ...body, currentPassword: 123 },
    { ...body, newPassword: null },
    { ...body, newPassword: "a".repeat(11) },
    { ...body, newPassword: "a".repeat(73) },
    { ...body, newPassword: "é".repeat(37) },
  ])("rejects invalid fields without writes: %j", async (value) => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    expect((await change(value)).status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
    expect(authMocks.hashPassword).not.toHaveBeenCalled();
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it("rejects an incorrect current password without writes", async () => {
    prepare();
    authMocks.verifyPassword.mockResolvedValueOnce(false);
    expect(await change()).toEqual({ status: 401, body: { error: "Invalid current password" } });
    expect(authMocks.verifyPassword).toHaveBeenCalledWith(body.currentPassword, "old-hash");
    expect(query).toHaveBeenCalledTimes(2);
    expect(authMocks.hashPassword).not.toHaveBeenCalled();
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it("rejects a Google-only user, who has no password, without writes", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [[null]] });
    expect(await change()).toEqual({ status: 400, body: { error: "This account has no password" } });
    expect(authMocks.verifyPassword).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it.each(["a".repeat(12), "a".repeat(72), "é".repeat(36)])(
    "changes a valid password atomically: %j",
    async (newPassword) => {
      prepare();
      query.mockResolvedValueOnce({ rows: [[userId]] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      expect((await change({ ...body, newPassword })).status).toBe(204);
      expect(authMocks.hashPassword).toHaveBeenCalledWith(newPassword);
      const update = query.mock.calls[3]!;
      expect(update[0].text).toContain('"password_changed_at"');
      expect(update[0].text).toContain('"updated_at"');
      expect(update[1]).toEqual(expect.arrayContaining(["$2b$12$hashed", "old-hash", userId]));
      const revoke = query.mock.calls[4]!;
      expect(revoke[0].text).toMatch(/update "session".*"user_id".*"revoked_at" is null/);
      expect(revoke[1]).toContain(userId);
      expect(query.mock.calls[2]![0].text).toBe("begin");
      expect(query.mock.calls[5]![0].text).toBe("commit");
      expect(authMocks.clearSessionCookie).toHaveBeenCalledTimes(1);
    },
  );

  it("does not overwrite a concurrent password change", async () => {
    prepare();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    expect((await change()).status).toBe(401);
    expect(query).toHaveBeenCalledTimes(5);
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it.each(["password", "sessions"])("rolls back when the %s update fails", async (step) => {
    prepare();
    if (step === "sessions") query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockRejectedValueOnce(new Error("DB down"));
    query.mockResolvedValueOnce({ rows: [] });
    await expect(change()).rejects.toThrow();
    expect(query.mock.calls.at(-1)![0].text).toBe("rollback");
    expect(authMocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it("uses the new password for login and rejects both devices' revoked tokens", async () => {
    const realAuth = await vi.importActual<typeof import("../../srcs/auth.ts")>("../../srcs/auth.ts");
    authMocks.hashPassword.mockImplementation(realAuth.hashPassword);
    authMocks.verifyPassword.mockImplementation(realAuth.verifyPassword);
    authMocks.getAuthenticatedUserId.mockImplementation(realAuth.getAuthenticatedUserId);
    let passwordHash = await realAuth.hashPassword(body.currentPassword);
    let revoked = false;
    query.mockImplementation(async (config: { text: string }, params: unknown[] = []) => {
      const sql = config.text;
      if (sql.includes('inner join "app_user"')) return { rows: revoked ? [] : [[userId, "session-id", new Date()]] };
      if (sql.startsWith('select "password_hash"')) return { rows: [[passwordHash]] };
      if (sql.startsWith('select "id", "email", "display_name"')) return { rows: [createdUserRow()] };
      if (sql.startsWith("select")) return { rows: [userRow({ passwordHash })] };
      if (sql.startsWith('update "app_user"')) {
        passwordHash = params[0] as string;
        return { rows: [[userId]] };
      }
      if (sql.startsWith('update "session"')) revoked = true;
      return { rows: [] };
    });
    const me = (token: string) => dispatch(authRouter, { method: "GET", url: "/me", cookies: { session: token } });
    for (const token of ["token", "other-device-token"]) expect((await me(token)).status).toBe(200);
    expect((await change()).status).toBe(204);
    for (const token of ["token", "other-device-token"]) expect((await me(token)).status).toBe(401);
    for (const [password, status] of [
      [body.currentPassword, 401],
      [body.newPassword, 200],
    ] as const) {
      expect(
        (
          await dispatch(authRouter, {
            method: "POST",
            url: "/login",
            body: { email: "alice@example.com", password },
          })
        ).status,
      ).toBe(status);
    }
  }, 15_000);
});

// ─── PATCH /me ────────────────────────────────────────────────────────────────

describe("PATCH /me", () => {
  const patch = (body: unknown, cookies: Record<string, string> = { session: "token" }) =>
    dispatch(authRouter, { method: "PATCH", url: "/me", body, cookies });

  it("requires authentication", async () => {
    const result = await dispatch(authRouter, { method: "PATCH", url: "/me", body: { displayName: "Bob" } });
    expect(result.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 when displayName key is absent", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    const result = await patch({});
    expect(result).toEqual({ status: 400, body: { error: "No editable field provided" } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, "displayName must be between 1 and 100 characters"],
    ["", "displayName must be between 1 and 100 characters"],
    ["   ", "displayName must be between 1 and 100 characters"],
    ["a".repeat(101), "displayName must be between 1 and 100 characters"],
  ])("returns 400 for invalid displayName %j", async (displayName, errorMsg) => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    const result = await patch({ displayName });
    expect(result).toEqual({ status: 400, body: { error: errorMsg } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with updated user on valid displayName", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] }); // requireAuthenticatedUser session lookup
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", null]] }); // updateUserProfile returning
    const result = await patch({ displayName: "Bob" });
    expect(result).toEqual({
      status: 200,
      body: { user: { id: userId, email: "alice@example.com", displayName: "Bob", avatarUrl: null } },
    });
  });

  it("returns the avatar route, not the storage key, so clients keep the avatar", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", "secret-key.png"]] });
    const result = await patch({ displayName: "Bob" });
    const { avatarUrl } = (result.body as { user: { avatarUrl: string } }).user;
    expect(avatarUrl).toMatch(/^\/auth\/me\/avatar\?v=[0-9a-f]{16}$/);
    expect(avatarUrl).not.toContain("secret-key");
  });

  it("trims the displayName before storing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", null]] });
    await patch({ displayName: "  Bob  " });
    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain("Bob");
    expect(updateParams).not.toContain("  Bob  ");
  });
});

// ─── Avatar endpoints ─────────────────────────────────────────────────────────

// findUserById positional row: [id, email, displayName, avatarUrl, hasPassword]
function meRow(avatarUrl: string | null = null) {
  return [userId, "alice@example.com", "Alice", avatarUrl, true, false];
}

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("PUT /me/avatar", () => {
  const avatarRequest = (body?: unknown) =>
    dispatch(authRouter, { method: "PUT", url: "/me/avatar", body, cookies: { session: "token" } });

  it("returns 401 without authentication", async () => {
    expect((await dispatch(authRouter, { method: "PUT", url: "/me/avatar", body: jpegBytes })).status).toBe(401);
    expect(storageMocks.writeAvatar).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing body", undefined],
    ["a parsed JSON body", {}],
    ["bytes that are not JPEG or PNG", Buffer.from("not an image")],
  ])("returns 415 for %s", async (_label, body) => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] }); // requireAuthenticatedUser session lookup
    expect(await avatarRequest(body)).toEqual({
      status: 415,
      body: { error: "Body must be a JPEG or PNG image" },
    });
    expect(storageMocks.writeAvatar).not.toHaveBeenCalled();
  });

  it("stores a JPEG and returns the avatar route instead of the key", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow()] }); // findUserById (old key)
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl

    const result = await avatarRequest(jpegBytes);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      user: {
        id: userId,
        email: "alice@example.com",
        displayName: "Alice",
        avatarUrl: expect.stringMatching(/^\/auth\/me\/avatar\?v=[0-9a-f]{16}$/),
        hasPassword: true,
        twoFactorEnabled: false,
      },
    });
    const [storedKey, storedBytes] = storageMocks.writeAvatar.mock.calls[0]!;
    expect(storedKey).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(storedBytes).toBe(jpegBytes);
    expect(query.mock.calls[2]![1]).toContain(storedKey);
  });

  it("stores a PNG with a .png key", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    await avatarRequest(pngBytes);
    expect(storageMocks.writeAvatar.mock.calls[0]![0]).toMatch(/\.png$/);
  });

  it("deletes the old avatar when replacing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("old-key.jpg")] });
    query.mockResolvedValueOnce({ rows: [] });

    await avatarRequest(pngBytes);
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("old-key.jpg");
  });

  it("removes the new file when the database update fails", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("old-key.jpg")] });
    query.mockRejectedValueOnce(new Error("DB down"));

    await expect(avatarRequest(jpegBytes)).rejects.toThrow();
    const [newKey] = storageMocks.writeAvatar.mock.calls[0]!;
    expect(storageMocks.deleteAvatar).toHaveBeenCalledExactlyOnceWith(newKey);
  });

  it("keeps the new file when the old file cannot be removed", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("old-key.jpg")] });
    query.mockResolvedValueOnce({ rows: [] });
    storageMocks.deleteAvatar.mockRejectedValueOnce(new Error("disk error"));

    expect((await avatarRequest(jpegBytes)).status).toBe(200);
    expect(storageMocks.deleteAvatar).toHaveBeenCalledExactlyOnceWith("old-key.jpg");
  });
});

describe("GET /me/avatar", () => {
  const avatarGet = () => dispatch(authRouter, { method: "GET", url: "/me/avatar", cookies: { session: "token" } });

  it("returns 401 without authentication", async () => {
    expect((await dispatch(authRouter, { method: "GET", url: "/me/avatar" })).status).toBe(401);
  });

  it("returns 404 when no avatar is set", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow(null)] }); // findUserById
    expect((await avatarGet()).status).toBe(404);
  });

  it("returns 404 when avatar key is set but file is missing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("lost.jpg")] });
    storageMocks.readAvatar.mockResolvedValueOnce(null);
    expect((await avatarGet()).status).toBe(404);
  });

  it("returns 200 with image buffer and correct content-type for JPEG", async () => {
    const buf = Buffer.from("fakeimage");
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] });
    storageMocks.readAvatar.mockResolvedValueOnce(buf);
    const result = await avatarGet();
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.headers).toEqual({ "Cache-Control": "private, no-cache" });
    expect(result.body).toBe(buf);
    expect(storageMocks.readAvatar).toHaveBeenCalledWith("photo.jpg");
  });
});

describe("DELETE /me/avatar", () => {
  const avatarDelete = () =>
    dispatch(authRouter, { method: "DELETE", url: "/me/avatar", cookies: { session: "token" } });

  it("returns 401 without authentication", async () => {
    expect((await dispatch(authRouter, { method: "DELETE", url: "/me/avatar" })).status).toBe(401);
  });

  it("removes the avatar file and clears avatar_url, returns 204", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] }); // findUserById
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl

    const result = await avatarDelete();
    expect(result.status).toBe(204);
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("photo.jpg");
    // The database is cleared before the file goes, so a failure never leaves a dangling key.
    expect(query.mock.invocationCallOrder[2]!).toBeLessThan(storageMocks.deleteAvatar.mock.invocationCallOrder[0]!);
  });

  it("returns 204 when no avatar is set (idempotent)", async () => {
    query.mockResolvedValueOnce({ rows: [[userId, "session-id", new Date()]] });
    query.mockResolvedValueOnce({ rows: [meRow(null)] });
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl always runs

    const result = await avatarDelete();
    expect(result.status).toBe(204);
    expect(storageMocks.deleteAvatar).not.toHaveBeenCalled();
  });
});

// ─── Two-factor authentication ────────────────────────────────────────────────

describe("two-factor authentication", () => {
  const sessionId = "session-1";
  const cookies = { session: "token" };
  const secret = generateSecret();
  const codeNow = () => totpCode(secret, currentStep());

  beforeEach(() => vi.stubEnv("TOTP_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")));
  afterEach(() => vi.unstubAllEnvs());

  const post = (url: string, body: unknown = {}, signedIn = true) =>
    dispatch(authRouter, { method: "POST", url, body, ...(signedIn ? { cookies } : {}) });
  const session = () => query.mockResolvedValueOnce({ rows: [[userId, sessionId, new Date()]] });
  // findTotpState columns: email, passwordHash, totpSecretEncrypted, totpEnabledAt, totpLastUsedStep
  const state = (overrides: Partial<Record<string, unknown>> = {}) => {
    const row = {
      email: "alice@example.com",
      hash: "hash",
      secret: encryptSecret(secret),
      on: null,
      step: null,
      ...overrides,
    };
    query.mockResolvedValueOnce({ rows: [[row.email, row.hash, row.secret, row.on, row.step]] });
  };
  const enabled = { on: new Date().toISOString() };

  it.each([
    ["/2fa/setup", true],
    ["/2fa/enable", true],
    ["/2fa/disable", true],
    ["/2fa/verify", false],
    ["/2fa/recover", false],
  ])("%s rejects requests without a session", async (url) => {
    expect((await post(url, {}, false)).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  describe("setup", () => {
    it("is 404 without TOTP_ENCRYPTION_KEY", async () => {
      vi.stubEnv("TOTP_ENCRYPTION_KEY", "");
      session();
      expect((await post("/2fa/setup")).status).toBe(404);
    });

    it("stores an encrypted secret and returns it with the otpauth URI", async () => {
      session();
      state();
      query.mockResolvedValueOnce({ rows: [[userId]] }); // saveTotpSecret
      const result = await post("/2fa/setup");
      const body = result.body as { secret: string; otpauthUri: string };
      expect(result.status).toBe(200);
      expect(body.otpauthUri).toContain(`secret=${body.secret}`);
      expect(query.mock.calls[2]![1]).not.toContain(body.secret); // only the ciphertext is stored
    });

    it("is 409 when 2FA is already enabled", async () => {
      session();
      state(enabled);
      query.mockResolvedValueOnce({ rows: [] }); // saveTotpSecret matches no row
      expect((await post("/2fa/setup")).status).toBe(409);
    });
  });

  describe("enable", () => {
    it("rejects a wrong code without activating", async () => {
      session();
      state();
      expect((await post("/2fa/enable", { code: "000000" })).status).toBe(401);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it("needs setup first and cannot run twice", async () => {
      session();
      state({ secret: null });
      expect((await post("/2fa/enable", { code: codeNow() })).status).toBe(409);
      session();
      state(enabled);
      expect((await post("/2fa/enable", { code: codeNow() })).status).toBe(409);
    });

    it("activates with the enrolment step and returns 10 recovery codes stored only as hashes", async () => {
      const encryptedSecret = encryptSecret(secret);
      session();
      state({ secret: encryptedSecret });
      query.mockResolvedValue({ rows: [[userId]] }); // begin, update, delete, insert, commit
      const result = await post("/2fa/enable", { code: codeNow() });
      const { recoveryCodes } = result.body as { recoveryCodes: string[] };
      expect(result.status).toBe(200);
      expect(recoveryCodes).toHaveLength(10);
      const update = query.mock.calls.find(([sql]) => sql.text?.startsWith('update "app_user"'))!;
      expect(update[0].text.split(" where ")[1]).toContain('"totp_secret_encrypted" =');
      expect(update[1]).toContain(encryptedSecret);
      const insert = query.mock.calls.find(([sql]) => sql.text?.startsWith('insert into "recovery_code"'))!;
      expect(insert[1]).toContain(hashRecoveryCode(recoveryCodes[0]!));
      expect(insert[1]).not.toContain(recoveryCodes[0]);
    });

    it("rejects activation if setup replaced the verified secret", async () => {
      session();
      state();
      query.mockResolvedValueOnce({ rows: [] }); // begin
      query.mockResolvedValueOnce({ rows: [] }); // update finds no matching secret
      query.mockResolvedValueOnce({ rows: [] }); // commit

      const result = await post("/2fa/enable", { code: codeNow() });

      expect(result).toEqual({
        status: 409,
        body: { error: "Two-factor authentication setup changed or is already enabled" },
      });
      expect(query.mock.calls.some(([sql]) => sql.text?.startsWith('insert into "recovery_code"'))).toBe(false);
    });
  });

  describe("verify", () => {
    it("completes the pending session with a valid code and claims its step", async () => {
      session();
      state(enabled);
      query.mockResolvedValueOnce({ rows: [[userId]] }); // claimTotpStep
      query.mockResolvedValueOnce({ rows: [meRow()] }); // findUserById
      const result = await post("/2fa/verify", { code: codeNow() });
      expect(result.status).toBe(200);
      expect(authMocks.completePendingSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        sessionId,
        userId,
      );
      expect((await logins.get()).values).toContainEqual({ value: 1, labels: { result: "success" } });
    });

    it("does not count success if completing the pending session fails", async () => {
      session();
      state(enabled);
      query.mockResolvedValueOnce({ rows: [[userId]] });
      authMocks.completePendingSession.mockRejectedValueOnce(new Error("session update failed"));
      await expect(post("/2fa/verify", { code: codeNow() })).rejects.toThrow("session update failed");
      expect((await logins.get()).values).toEqual([]);
    });

    it("rejects a replayed or wrong code and leaves the session pending", async () => {
      session();
      state({ ...enabled, step: currentStep() + 1 }); // every step in the window is already used
      expect((await post("/2fa/verify", { code: codeNow() })).status).toBe(401);
      session();
      state(enabled);
      query.mockResolvedValueOnce({ rows: [] }); // claimTotpStep lost a concurrent race
      expect((await post("/2fa/verify", { code: codeNow() })).status).toBe(401);
      expect(authMocks.completePendingSession).not.toHaveBeenCalled();
      expect((await logins.get()).values).toContainEqual({ value: 2, labels: { result: "failure" } });
    });

    it("rejects a non-string code", async () => {
      session();
      expect((await post("/2fa/verify", { code: 123456 })).status).toBe(400);
    });
  });

  describe("recover", () => {
    it("completes the pending session once and burns the code", async () => {
      session();
      query.mockResolvedValueOnce({ rows: [["code-id"]] }); // burnRecoveryCode
      query.mockResolvedValueOnce({ rows: [meRow()] });
      expect((await post("/2fa/recover", { recoveryCode: "abcde-23456" })).status).toBe(200);
      expect(query.mock.calls[1]![1]).toContain(hashRecoveryCode("ABCDE-23456")); // case and dash are normalised
      expect(authMocks.completePendingSession).toHaveBeenCalledOnce();

      session();
      query.mockResolvedValueOnce({ rows: [] }); // already used
      expect((await post("/2fa/recover", { recoveryCode: "ABCDE-23456" })).status).toBe(401);
      expect(authMocks.completePendingSession).toHaveBeenCalledOnce();
      expect((await logins.get()).values).toEqual(
        expect.arrayContaining([
          { value: 1, labels: { result: "success" } },
          { value: 1, labels: { result: "failure" } },
        ]),
      );
    });
  });

  describe("disable", () => {
    it("is 409 when 2FA is off", async () => {
      session();
      state();
      expect((await post("/2fa/disable", { code: codeNow() })).status).toBe(409);
    });

    it("requires the password for accounts that have one, with one generic error", async () => {
      session();
      state(enabled);
      expect(await post("/2fa/disable", { code: codeNow() })).toEqual({
        status: 401,
        body: { error: "Invalid password or code" },
      });
      session();
      state(enabled);
      authMocks.verifyPassword.mockResolvedValueOnce(false);
      expect((await post("/2fa/disable", { password: "wrong", code: codeNow() })).body).toEqual({
        error: "Invalid password or code",
      });
      expect(query).toHaveBeenCalledTimes(4); // nothing was written
    });

    it("rejects a wrong code after the password check passes", async () => {
      session();
      state(enabled);
      const result = await post("/2fa/disable", { password: "right", code: "000000" });
      expect(result).toEqual({ status: 401, body: { error: "Invalid password or code" } });
      expect(authMocks.verifyPassword).toHaveBeenCalledWith("right", "hash");
    });

    it("lets a Google-only user disable with a code alone and revokes the other sessions", async () => {
      session();
      state({ ...enabled, hash: null });
      query.mockResolvedValue({ rows: [[userId]] });
      expect((await post("/2fa/disable", { code: codeNow() })).status).toBe(204);
      expect(authMocks.verifyPassword).not.toHaveBeenCalled();
      const revoke = query.mock.calls.find(([sql]) => sql.text?.startsWith('update "session"'))!;
      expect(revoke[0].text).toContain('"session"."id" <> $');
      expect(revoke[1]).toContain(sessionId);
    });

    it("accepts a recovery code instead of a TOTP code", async () => {
      session();
      state({ ...enabled, hash: null });
      query.mockResolvedValue({ rows: [[userId]] });
      expect((await post("/2fa/disable", { recoveryCode: "ABCDE-23456" })).status).toBe(204);
    });
  });
});
