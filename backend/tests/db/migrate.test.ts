import { fileURLToPath } from "node:url";

import { beforeEach, expect, it, vi } from "vitest";

const { migrate, db, end } = vi.hoisted(() => ({ migrate: vi.fn(), db: {}, end: vi.fn() }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
vi.mock("../../srcs/db/client.ts", () => ({ db, pool: { end } }));

import { runMigrations } from "../../srcs/db/migrate.ts";

beforeEach(() => vi.clearAllMocks());

it("resolves migrations relative to the module and leaves the server pool open", async () => {
  await runMigrations();
  expect(migrate).toHaveBeenCalledWith(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  });
  expect(end).not.toHaveBeenCalled();
});

it("propagates migration failures", async () => {
  migrate.mockRejectedValueOnce(new Error("Migration failed"));
  await expect(runMigrations()).rejects.toThrow("Migration failed");
});
