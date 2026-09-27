import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("db/client.ts", () => {
  it("throws when DATABASE_URL is not set", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();
    await expect(import("../../srcs/db/client.ts")).rejects.toThrow("DATABASE_URL is not set");
  });

  it("exports db and pool without connecting when DATABASE_URL is set", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/test");
    vi.resetModules();
    const { db, pool } = await import("../../srcs/db/client.ts");
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
    // Cleanup to avoid open handles
    await pool.end().catch(() => undefined);
  });

  it("logs pool errors instead of crashing", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/test");
    vi.resetModules();
    const consoleSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const { pool } = await import("../../srcs/db/client.ts");

    const error = new Error("connection lost");
    pool.emit("error", error);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("pool error"), error);
    consoleSpy.mockRestore();
    await pool.end().catch(() => undefined);
  });
});
