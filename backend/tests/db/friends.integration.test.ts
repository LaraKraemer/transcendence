import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../srcs/db/client.ts", async () => {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  return { pool, db: drizzle(pool) };
});

import { createApp } from "../../srcs/app.ts";
import { pool } from "../../srcs/db/client.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("friends with PostgreSQL", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await pool.connect();
    await pool.query("BEGIN");
    server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query("ROLLBACK");
    await pool.end();
  });

  it("scopes requests and presence, enforces an unordered pair, and cascades user deletion", async () => {
    const accounts = ["alice", "bob", "carol"].map((name) => ({
      id: randomUUID(),
      email: `friends-${name}-${randomUUID()}@example.com`,
      token: randomUUID(),
      name,
    }));
    const [alice, bob, carol] = accounts;
    if (!alice || !bob || !carol) throw new Error("Missing test account");
    for (const account of accounts) {
      await pool.query("INSERT INTO app_user (id, email, password_hash, display_name) VALUES ($1, $2, 'unused', $3)", [
        account.id,
        account.email,
        account.name,
      ]);
      await pool.query(
        "INSERT INTO session (user_id, token_hash, expires_at, twofa_verified_at) VALUES ($1, $2, now() + interval '1 day', now())",
        [account.id, createHash("sha256").update(account.token).digest("hex")],
      );
    }

    const call = (account: typeof alice | null, path: string, method = "GET", data?: object) =>
      fetch(`${baseUrl}/friends${path}`, {
        method,
        headers: {
          ...(account ? { Cookie: `session=${account.token}` } : {}),
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    expect((await call(null, "/")).status).toBe(401);
    expect((await call(null, "/", "POST", { email: bob.email })).status).toBe(401);
    expect((await call(alice, "/", "POST", { email: "bad" })).status).toBe(400);
    expect((await call(alice, "/", "POST", { email: "missing@example.com" })).status).toBe(404);
    expect((await call(alice, "/", "POST", { email: alice.email })).status).toBe(409);

    const created = await call(alice, "/", "POST", { email: `  ${bob.email.toUpperCase()}  ` });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await call(alice, "/", "POST", { email: bob.email })).status).toBe(409);
    expect((await call(bob, "/", "POST", { email: alice.email })).status).toBe(409);
    expect((await pool.query("SELECT id FROM user_connection WHERE id = $1", [id])).rowCount).toBe(1);

    const outgoing = await call(alice, "/");
    expect(outgoing.headers.get("cache-control")).toBe("no-store");
    expect(await outgoing.json()).toEqual({
      friends: [],
      incoming: [],
      outgoing: [{ id, user: { id: bob.id, email: bob.email, displayName: "bob" } }],
    });
    const pending = await (await call(bob, "/")).json();
    expect(pending).toEqual({
      friends: [],
      incoming: [{ id, user: { id: alice.id, email: alice.email, displayName: "alice" } }],
      outgoing: [],
    });
    expect((await call(carol, `/${id}/accept`, "POST")).status).toBe(404);
    expect((await call(alice, `/${id}/accept`, "POST")).status).toBe(404);
    expect((await call(carol, `/${id}`, "DELETE")).status).toBe(404);
    expect((await call(bob, "/invalid/accept", "POST")).status).toBe(400);
    expect((await call(bob, "/invalid", "DELETE")).status).toBe(400);
    expect((await call(bob, `/${id}/accept`, "POST")).status).toBe(204);
    expect((await call(bob, `/${id}/accept`, "POST")).status).toBe(404);
    const accepted = await (await call(bob, "/")).json();
    expect(accepted.friends).toEqual([
      {
        id,
        user: { id: alice.id, email: alice.email, displayName: "alice" },
        online: true,
      },
    ]);

    await pool.query("UPDATE app_user SET last_active_at = now() - interval '10 minutes 1 second' WHERE id = $1", [
      alice.id,
    ]);
    expect((await (await call(bob, "/")).json()).friends[0].online).toBe(false);
    await pool.query("UPDATE app_user SET last_active_at = now() - interval '9 minutes 59 seconds' WHERE id = $1", [
      alice.id,
    ]);
    expect((await (await call(bob, "/")).json()).friends[0].online).toBe(true);

    expect((await call(alice, `/${id}`, "DELETE")).status).toBe(204);
    expect((await call(bob, `/${id}`, "DELETE")).status).toBe(404);
    const repeated = await call(bob, "/", "POST", { email: alice.email });
    expect(repeated.status).toBe(201);
    const repeatedId = ((await repeated.json()) as { id: string }).id;
    expect((await call(bob, `/${repeatedId}`, "DELETE")).status).toBe(204);
    const removal = await call(alice, "/", "POST", { email: bob.email });
    expect(removal.status).toBe(201);
    await pool.query("DELETE FROM app_user WHERE id = $1", [bob.id]);
    expect(
      (await pool.query("SELECT 1 FROM user_connection WHERE id = $1", [((await removal.json()) as { id: string }).id]))
        .rowCount,
    ).toBe(0);
    expect((await call(alice, "/")).status).toBe(200);
    const attempts = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      attempts.push(await call(alice, "/", "POST", { email: "invalid" }));
    }
    expect(attempts.some((response) => response.status === 429)).toBe(true);
  });
});
