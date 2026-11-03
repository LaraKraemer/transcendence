import { expect, it, vi } from "vitest";

const { Pool } = vi.hoisted(() => ({
  Pool: vi.fn(function () {
    return { on: vi.fn() };
  }),
}));
vi.mock("pg", () => ({ default: { Pool } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn() }));

it("limits status connections without adding a deadline to application requests", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://localhost/status_pool_test");
  try {
    const { pool, statusPool } = await import("../../srcs/db/client.ts");
    expect(pool).not.toBe(statusPool);
    expect(Pool).toHaveBeenNthCalledWith(1, { connectionString: "postgres://localhost/status_pool_test" });
    expect(Pool).toHaveBeenNthCalledWith(2, {
      connectionString: "postgres://localhost/status_pool_test",
      max: 1,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
