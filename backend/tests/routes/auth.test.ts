import { beforeEach, describe, expect, it, vi } from "vitest";

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
  clearSessionCookie: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  revokeCurrentSession: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("$2b$12$dummy"),
  verifyPassword: vi.fn(),
}));
vi.mock("../../srcs/auth.ts", async (importOriginal) => ({
  requireAuthenticatedUser: (await importOriginal<typeof import("../../srcs/auth.ts")>()).requireAuthenticatedUser,
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
// emailVerifiedAt, passwordChangedAt, createdAt, updatedAt
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
    // findUserById returns { id, email, displayName, avatarUrl }
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", null]] });

    const result = await dispatch(authRouter, { method: "GET", url: "/me" });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      user: { id: userId, email: "alice@example.com", displayName: "Alice", avatarUrl: null },
    });
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).not.toContain("password_hash");
  });

  it("exposes the avatar route instead of the storage key", async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValueOnce(userId);
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Alice", "secret-key.png"]] });
    const result = await dispatch(authRouter, { method: "GET", url: "/me" });
    expect(result.body).toMatchObject({ user: { avatarUrl: "/auth/me/avatar" } });
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
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow()] }); // findUserById
    query.mockResolvedValueOnce({ rows: [] });
    expect(await remove({ session: "valid" })).toEqual({ status: 204, body: undefined });
    expect(query.mock.calls[2]![0].text).toMatch(/^delete from "app_user" where "app_user"\."id" = \$1$/);
    expect(query.mock.calls[2]![1]).toEqual([userId]);
    expect(authMocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(storageMocks.deleteAvatar).not.toHaveBeenCalled();
  });

  it("removes the avatar file once the user is deleted", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] });
    query.mockResolvedValueOnce({ rows: [] });
    await remove({ session: "valid" });
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("photo.jpg");
  });

  it("forwards deletion failures without clearing the cookie", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
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
    query.mockResolvedValueOnce({ rows: [[userId]] });
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
    query.mockResolvedValueOnce({ rows: [[userId]] });
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
      if (sql.includes('inner join "app_user"')) return { rows: revoked ? [] : [[userId]] };
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
    query.mockResolvedValueOnce({ rows: [[userId]] });
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
    query.mockResolvedValueOnce({ rows: [[userId]] });
    const result = await patch({ displayName });
    expect(result).toEqual({ status: 400, body: { error: errorMsg } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with updated user on valid displayName", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] }); // requireAuthenticatedUser session lookup
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", null]] }); // updateUserProfile returning
    const result = await patch({ displayName: "Bob" });
    expect(result).toEqual({
      status: 200,
      body: { user: { id: userId, email: "alice@example.com", displayName: "Bob", avatarUrl: null } },
    });
  });

  it("returns the avatar route, not the storage key, so clients keep the avatar", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", "secret-key.png"]] });
    const result = await patch({ displayName: "Bob" });
    expect(result.body).toMatchObject({ user: { avatarUrl: "/auth/me/avatar" } });
  });

  it("trims the displayName before storing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [[userId, "alice@example.com", "Bob", null]] });
    await patch({ displayName: "  Bob  " });
    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain("Bob");
    expect(updateParams).not.toContain("  Bob  ");
  });
});

// ─── Avatar endpoints ─────────────────────────────────────────────────────────

// findUserById positional row: [id, email, displayName, avatarUrl]
function meRow(avatarUrl: string | null = null) {
  return [userId, "alice@example.com", "Alice", avatarUrl];
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
    query.mockResolvedValueOnce({ rows: [[userId]] }); // requireAuthenticatedUser session lookup
    expect(await avatarRequest(body)).toEqual({
      status: 415,
      body: { error: "Body must be a JPEG or PNG image" },
    });
    expect(storageMocks.writeAvatar).not.toHaveBeenCalled();
  });

  it("stores a JPEG and returns the avatar route instead of the key", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow()] }); // findUserById (old key)
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl

    const result = await avatarRequest(jpegBytes);
    expect(result).toEqual({
      status: 200,
      body: { user: { id: userId, email: "alice@example.com", displayName: "Alice", avatarUrl: "/auth/me/avatar" } },
    });
    const [storedKey, storedBytes] = storageMocks.writeAvatar.mock.calls[0]!;
    expect(storedKey).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(storedBytes).toBe(jpegBytes);
    expect(query.mock.calls[2]![1]).toContain(storedKey);
  });

  it("stores a PNG with a .png key", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    await avatarRequest(pngBytes);
    expect(storageMocks.writeAvatar.mock.calls[0]![0]).toMatch(/\.png$/);
  });

  it("deletes the old avatar when replacing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow("old-key.jpg")] });
    query.mockResolvedValueOnce({ rows: [] });

    await avatarRequest(pngBytes);
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("old-key.jpg");
  });

  it("removes the new file when the database update fails", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow("old-key.jpg")] });
    query.mockRejectedValueOnce(new Error("DB down"));

    await expect(avatarRequest(jpegBytes)).rejects.toThrow();
    const [newKey] = storageMocks.writeAvatar.mock.calls[0]!;
    expect(storageMocks.deleteAvatar).toHaveBeenCalledExactlyOnceWith(newKey);
  });

  it("keeps the new file when the old file cannot be removed", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
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
    query.mockResolvedValueOnce({ rows: [[userId]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow(null)] }); // findUserById
    expect((await avatarGet()).status).toBe(404);
  });

  it("returns 404 when avatar key is set but file is missing", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow("lost.jpg")] });
    storageMocks.readAvatar.mockResolvedValueOnce(null);
    expect((await avatarGet()).status).toBe(404);
  });

  it("returns 200 with image buffer and correct content-type for JPEG", async () => {
    const buf = Buffer.from("fakeimage");
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] });
    storageMocks.readAvatar.mockResolvedValueOnce(buf);
    const result = await avatarGet();
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.headers).toEqual({ "Cache-Control": "no-cache" });
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
    query.mockResolvedValueOnce({ rows: [[userId]] }); // session lookup
    query.mockResolvedValueOnce({ rows: [meRow("photo.jpg")] }); // findUserById
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl

    const result = await avatarDelete();
    expect(result.status).toBe(204);
    expect(storageMocks.deleteAvatar).toHaveBeenCalledWith("photo.jpg");
    // The database is cleared before the file goes, so a failure never leaves a dangling key.
    expect(query.mock.invocationCallOrder[2]!).toBeLessThan(storageMocks.deleteAvatar.mock.invocationCallOrder[0]!);
  });

  it("returns 204 when no avatar is set (idempotent)", async () => {
    query.mockResolvedValueOnce({ rows: [[userId]] });
    query.mockResolvedValueOnce({ rows: [meRow(null)] });
    query.mockResolvedValueOnce({ rows: [] }); // updateUserAvatarUrl always runs

    const result = await avatarDelete();
    expect(result.status).toBe(204);
    expect(storageMocks.deleteAvatar).not.toHaveBeenCalled();
  });
});
