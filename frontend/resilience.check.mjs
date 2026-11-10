// Disposable local data only. See docs/testing.md, "Evaluator resilience checks".
// API_URL=... FRONTEND_URL=... RESILIENCE_DISPOSABLE=1 NODE_EXTRA_CA_CERTS=... \
//   node --experimental-strip-types resilience.check.mjs boundaries /absolute/path/results.json
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, request as playwrightRequest } from "playwright";

import { currentStep, totpCode } from "../backend/srcs/totp.ts";

const [suite, outputPath] = process.argv.slice(2);
const suites = [
  "boundaries",
  "integrity",
  "precision",
  "nul-text",
  "timestamp",
  "avatar",
  "browser",
  "pressure",
  "delete-race",
  "upload-race",
];
assert.ok(suites.includes(suite), `Choose one suite: ${suites.join(", ")}`);
assert.ok(outputPath && isAbsolute(outputPath), "Supply an absolute evidence output path");
assert.equal(process.env.RESILIENCE_DISPOSABLE, "1", "Explicitly confirm a disposable instance");
const apiUrl = new URL(process.env.API_URL);
const frontendUrl = new URL(process.env.FRONTEND_URL);
for (const url of [apiUrl, frontendUrl]) {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Local targets only");
  assert.ok(["http:", "https:"].includes(url.protocol));
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/");
}
assert.equal(apiUrl.hostname, frontendUrl.hostname, "Session cookies require the same hostname");

const requestTimeoutMs = 10_000;
const navigationTimeoutMs = 30_000;
const workloadRequestLimit = 300;
const pressureIntervalMs = 500;
const pressureDurationMs = 30_000;
const maxBodyBytes = 6 * 1024 * 1024 + 1;
const bookedOn = "2026-03-15";
const runId = randomUUID();
const password = randomBytes(24).toString("base64url");
const events = [];
const users = [];
let browser;
let phase = "setup";
let workloadRequests = 0;
let activeRequests = 0;
let stopped = false;
let completed = false;

async function send(context, method, path, expected, data, options = {}) {
  assert.ok(!stopped || phase === "cleanup", "Scheduling stopped after a failure");
  assert.ok(path.startsWith("/") && !path.startsWith("//"));
  if (phase === "workload") assert.ok(++workloadRequests <= workloadRequestLimit, "Request ceiling reached");
  assert.ok(activeRequests < 4, "Concurrency ceiling reached");
  activeRequests++;
  const started = performance.now();
  try {
    if (Buffer.isBuffer(data)) assert.ok(data.length <= maxBodyBytes, "Body ceiling reached");
    const response = await context.fetch(new URL(path, apiUrl).href, {
      method,
      ...(data === undefined ? {} : { data }),
      timeout: requestTimeoutMs,
      maxRedirects: 0,
      ...options,
    });
    const body = await response.text();
    const status = response.status();
    events.push({ phase, method, path, status, durationMs: Math.round(performance.now() - started) });
    if (status >= 500) stopped = true;
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(status),
      `${method} ${path}: expected ${expected}, got ${status}; ${body.slice(0, 200)}`,
    );
    if (status === 204) return null;
    return response.headers()["content-type"]?.includes("application/json") ? JSON.parse(body) : body;
  } catch (error) {
    stopped = true;
    throw error;
  } finally {
    activeRequests--;
  }
}

async function check(name, run) {
  try {
    await run();
    events.push({ check: name, result: "pass" });
    console.log(`PASS ${name}`);
  } catch (error) {
    stopped = true;
    events.push({ check: name, result: "fail", error: error.message.split("\n")[0] });
    throw error;
  }
}

async function newContext() {
  return playwrightRequest.newContext({ timeout: requestTimeoutMs });
}

async function cloneSession(user) {
  return playwrightRequest.newContext({ storageState: await user.context.storageState(), timeout: requestTimeoutMs });
}

async function account(user, name, extra = {}) {
  return send(user.context, "POST", "/accounts", 201, { name, type: "checking", currencyCode: "EUR", ...extra });
}

async function entry(user, extra = {}, expected = 201) {
  return send(user.context, "POST", "/transactions", expected, {
    accountId: user.account.id,
    type: "expense",
    amountMinor: -100,
    bookedOn,
    ...extra,
  });
}

function document(transactions, extra = {}) {
  return { version: 1, currency: "EUR", transactions, ...extra };
}

function importRow(extra = {}) {
  return { type: "expense", amountMinor: -1, bookedOn, ...extra };
}

async function list(user, query = "") {
  return send(user.context, "GET", `/transactions?accountId=${user.account.id}${query}`, 200);
}

async function health() {
  const context = await newContext();
  try {
    assert.equal((await send(context, "GET", "/health", 200)).status, "ok");
  } finally {
    await context.dispose();
  }
}

try {
  await health();
  for (let index = 0; index < (suite === "integrity" ? 3 : 2); index++) {
    const user = {
      context: await newContext(),
      email: `resilience-${runId}-${index}@example.com`,
      password,
    };
    users.push(user);
    const registered = await send(user.context, "POST", "/auth/register", 201, {
      email: user.email,
      password: user.password,
      displayName: `Resilience ${index}`,
    });
    user.id = registered.user.id;
    user.account = await account(user, `Resilience ${index}`);
    user.category = await send(user.context, "POST", "/categories", 201, {
      name: "Probe category",
      types: ["expense"],
      icon: "shopping-cart",
      color: "#16A34A",
    });
    user.entry = await entry(user, { description: `Fixture ${index}`, categoryId: user.category.id });
  }
  const [alice, bob, charlie] = users;
  phase = "workload";

  if (suite === "boundaries") {
    await check("malformed JSON and non-object bodies reject without writes", async () => {
      const before = (await list(alice)).total;
      for (const raw of ["{", "null", "[]", "true", '""']) {
        await send(alice.context, "POST", "/accounts", 400, Buffer.from(raw), {
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal((await list(alice)).total, before);
    });
    await check("field types, signs, lengths and impossible dates reject", async () => {
      for (const extra of [
        { amountMinor: 0 },
        { amountMinor: 1 },
        { amountMinor: -1.5 },
        { amountMinor: "-1" },
        { amountMinor: -Number.MAX_SAFE_INTEGER - 1 },
        { type: "transfer" },
        { type: ["expense"] },
        { description: "x".repeat(501) },
        { notes: "x".repeat(2001) },
        { merchant: {} },
        { bookedOn: "2026-02-29" },
        { bookedOn: "0000-01-01" },
        { occurredAt: "not-a-date" },
      ])
        await entry(alice, extra, 400);
      for (const name of [" ", "x".repeat(101), {}, null]) {
        await send(alice.context, "POST", "/accounts", 400, { name, type: "checking" });
      }
    });
    await check("body limits reject at parser and proxy boundaries", async () => {
      for (const [path, size] of [
        ["/accounts", 100 * 1024 - 1],
        ["/accounts", 100 * 1024 + 1],
        [`/transactions/import?accountId=${alice.account.id}`, 5 * 1024 * 1024 - 1],
        [`/transactions/import?accountId=${alice.account.id}`, 5 * 1024 * 1024 + 1],
        ["/accounts", maxBodyBytes],
      ]) {
        const raw = Buffer.from(`{"padding":"${"x".repeat(size - 14)}"}`);
        assert.equal(raw.length, size);
        const limit = path.startsWith("/transactions/import") ? 5 * 1024 * 1024 : 100 * 1024;
        await send(alice.context, "POST", path, size > limit ? 413 : 400, raw, {
          headers: { "content-type": "application/json" },
        });
      }
    });
    await check("import limits, unsupported fields and invalid final row are atomic", async () => {
      const path = `/transactions/import?accountId=${alice.account.id}`;
      const before = (await list(alice)).total;
      for (const value of [
        document([]),
        document(Array.from({ length: 1001 }, () => importRow())),
        document([importRow(), importRow({ amountMinor: 0 })]),
        document([importRow({ createdById: bob.id })]),
        document([importRow()], { accountId: bob.account.id }),
        document([importRow()], { currency: "USD" }),
        document([importRow({ category: "Missing category" })]),
      ])
        await send(alice.context, "POST", path, 400, value);
      assert.equal((await list(alice)).total, before);
      const imported = await send(
        alice.context,
        "POST",
        path,
        201,
        document(Array.from({ length: 1000 }, () => importRow())),
      );
      assert.equal(imported.imported, 1000);
      assert.equal((await list(alice)).total, before + 1000);
    });
    await check("pagination rejects invalid values and handles a very large valid offset", async () => {
      for (const query of [
        "limit=0",
        "limit=201",
        "limit=1&limit=2",
        "offset=-1",
        "offset=1.5",
        "offset=9007199254740992",
        "sort=unknown",
        "minAmountMinor=2&maxAmountMinor=1",
        "from=2026-02-29",
        "q=a&q=b",
      ])
        await send(alice.context, "GET", `/transactions?${query}`, 400);
      assert.equal((await list(alice, "&offset=9007199254740991")).items.length, 0);
      const first = await list(alice, "&limit=1&sort=bookedOn&order=asc");
      const repeated = await list(alice, "&limit=1&sort=bookedOn&order=asc");
      const second = await list(alice, "&limit=1&offset=1&sort=bookedOn&order=asc");
      assert.equal(first.items[0].id, repeated.items[0].id);
      assert.notEqual(first.items[0].id, second.items[0].id);
    });
    await check("report range boundaries and currency separation", async () => {
      for (const query of [
        "",
        "from=2026-01-02&to=2026-01-01",
        "from=2026-02-29&to=2026-03-01",
        "from=2020-01-01&to=2025-01-02",
        "from=2026-01-01&to=2026-01-02&type=transfer",
      ])
        await send(alice.context, "GET", `/analytics/categories?${query}`, 400);
      await send(alice.context, "GET", "/analytics/categories?from=2020-01-01&to=2025-01-01", 200);
      const usd = await account(alice, "USD", { currencyCode: "USD" });
      await entry(alice, { accountId: usd.id, amountMinor: -321 });
      const rows = await send(alice.context, "GET", `/analytics/categories?from=${bookedOn}&to=${bookedOn}`, 200);
      assert.equal(rows.find((row) => row.currencyCode === "USD").totalMinor, -321);
      assert.ok(rows.some((row) => row.currencyCode === "EUR"));
      for (const granularity of ["day", "week", "month"]) {
        const series = await send(
          alice.context,
          "GET",
          `/analytics/timeseries?from=2026-03-01&to=2026-03-31&granularity=${granularity}`,
          200,
        );
        assert.ok(series.some((row) => row.currencyCode === "EUR"));
        assert.ok(series.some((row) => row.currencyCode === "USD"));
      }
    });
    await check("search treats SQL/HTML markers as text and CSV escapes formulas", async () => {
      const description = `=1+1,"quoted"\n<img data-resilience-marker src=x>`;
      await entry(alice, { description, merchant: "  @SUM(1,2)" });
      const matched = await list(alice, `&q=${encodeURIComponent("data-resilience-marker")}`);
      assert.equal(matched.total, 1);
      assert.equal((await list(alice, `&q=${encodeURIComponent("' OR 1=1 --")}`)).total, 0);
      const csv = await send(
        alice.context,
        "GET",
        `/transactions/export?format=csv&from=${bookedOn}&to=${bookedOn}`,
        200,
      );
      assert.ok(csv.includes(`"'=1+1,""quoted""\n<img data-resilience-marker src=x>"`));
      assert.ok(csv.includes(`"'@SUM(1,2)"`));
    });
    await check("archive rejects new writes but permits editing existing transactions", async () => {
      await send(alice.context, "PATCH", `/accounts/${alice.account.id}`, 200, { isArchived: true });
      await entry(alice, {}, 409);
      await send(
        alice.context,
        "POST",
        `/transactions/import?accountId=${alice.account.id}`,
        409,
        document([importRow()]),
      );
      await send(alice.context, "PATCH", `/transactions/${alice.entry.id}`, 200, { description: "Archived edit" });
      await send(alice.context, "PATCH", `/accounts/${alice.account.id}`, 409, { name: "Cannot edit yet" });
      await send(alice.context, "PATCH", `/accounts/${alice.account.id}`, 200, { isArchived: false });
      await send(alice.context, "PATCH", `/accounts/${alice.account.id}`, 409, { currencyCode: "USD" });
    });
  }

  if (suite === "integrity") {
    await check("foreign resources remain private and unchanged", async () => {
      const before = await list(bob);
      for (const path of [
        `/accounts/${bob.account.id}`,
        `/accounts/${bob.account.id}/balance`,
        `/categories/${bob.category.id}`,
        `/transactions/${bob.entry.id}`,
        `/transactions?accountId=${bob.account.id}`,
        `/transactions/count/${bob.category.id}`,
        `/transactions?categoryId=${bob.category.id}`,
        `/analytics/categories?from=${bookedOn}&to=${bookedOn}&accountId=${bob.account.id}`,
        `/transactions/export?format=csv&from=${bookedOn}&to=${bookedOn}&accountId=${bob.account.id}`,
      ])
        await send(alice.context, "GET", path, 404);
      for (const [path, data] of [
        [`/accounts/${bob.account.id}`, { name: "Foreign edit" }],
        [`/categories/${bob.category.id}`, { name: "Foreign edit" }],
        [`/transactions/${bob.entry.id}`, { amountMinor: -2 }],
      ]) {
        await send(alice.context, "PATCH", path, 404, data);
        await send(alice.context, "DELETE", path, 404);
      }
      await entry(alice, { accountId: bob.account.id }, 404);
      await entry(alice, { categoryId: bob.category.id }, 404);
      await send(
        alice.context,
        "POST",
        `/transactions/import?accountId=${bob.account.id}`,
        404,
        document([importRow()]),
      );
      await send(alice.context, "POST", "/transactions/transfers", 404, {
        fromAccountId: alice.account.id,
        toAccountId: bob.account.id,
        fromAmountMinor: 1,
        toAmountMinor: 1,
        bookedOn,
      });
      assert.deepEqual(await list(bob), before);
      const anonymous = await newContext();
      try {
        for (const path of ["/accounts", "/transactions", "/currencies", "/friends", "/auth/me/avatar"]) {
          await send(anonymous, "GET", path, 401);
        }
      } finally {
        await anonymous.dispose();
      }
    });
    await check("friendship requests cannot be accepted or removed by a third user", async () => {
      const connection = await send(alice.context, "POST", "/friends", 201, { email: bob.email });
      await send(alice.context, "POST", `/friends/${connection.id}/accept`, 404);
      await send(charlie.context, "POST", `/friends/${connection.id}/accept`, 404);
      await send(charlie.context, "DELETE", `/friends/${connection.id}`, 404);
      await send(bob.context, "POST", `/friends/${connection.id}/accept`, 204);
      assert.equal((await send(alice.context, "GET", "/friends", 200)).friends.length, 1);
      await send(alice.context, "DELETE", `/friends/${connection.id}`, 204);
    });
    await check("transfer writes and deletes preserve both legs under double submission", async () => {
      const destination = await account(alice, "Transfer destination");
      const transfers = await Promise.all(
        Array.from({ length: 2 }, () =>
          send(alice.context, "POST", "/transactions/transfers", 201, {
            fromAccountId: alice.account.id,
            toAccountId: destination.id,
            fromAmountMinor: 123,
            toAmountMinor: 123,
            bookedOn,
          }),
        ),
      );
      for (const { from, to } of transfers) {
        assert.equal(from.transferGroupId, to.transferGroupId);
        assert.equal(from.amountMinor + to.amountMinor, 0);
        await send(alice.context, "PATCH", `/transactions/${from.id}`, 400, { description: "Edit" });
        await send(alice.context, "DELETE", `/transactions/${from.id}`, 204);
        await send(alice.context, "GET", `/transactions/${to.id}`, 404);
      }
      assert.equal((await send(alice.context, "GET", `/accounts/${destination.id}/balance`, 200)).balanceMinor, 0);
    });
    await check("logout revokes replayed session cookies", async () => {
      const stale = await cloneSession(bob);
      try {
        await send(bob.context, "POST", "/auth/logout", 204);
        await send(stale, "GET", "/accounts", 401);
        await send(bob.context, "POST", "/auth/login", 200, { email: bob.email, password: bob.password });
      } finally {
        await stale.dispose();
      }
    });
    await check("password change revokes every existing session", async () => {
      const stale = await cloneSession(bob);
      const other = await newContext();
      try {
        await send(other, "POST", "/auth/login", 200, { email: bob.email, password: bob.password });
        const nextPassword = randomBytes(24).toString("base64url");
        await send(bob.context, "PATCH", "/auth/password", 204, {
          currentPassword: bob.password,
          newPassword: nextPassword,
        });
        bob.password = nextPassword;
        await send(stale, "GET", "/accounts", 401);
        await send(other, "GET", "/accounts", 401);
        await send(bob.context, "POST", "/auth/login", 200, { email: bob.email, password: bob.password });
      } finally {
        await stale.dispose();
        await other.dispose();
      }
    });
    await check("pending 2FA sessions are isolated and recovery codes are single use under concurrency", async () => {
      const setup = await send(charlie.context, "POST", "/auth/2fa/setup", 200);
      const code = totpCode(setup.secret, currentStep());
      const enabled = await send(charlie.context, "POST", "/auth/2fa/enable", 200, { code });
      charlie.recoveryCodes = [...enabled.recoveryCodes];
      const pending = [await newContext(), await newContext()];
      try {
        for (const context of pending) {
          assert.equal(
            (await send(context, "POST", "/auth/login", 200, { email: charlie.email, password: charlie.password }))
              .twoFactorRequired,
            true,
          );
          await send(context, "GET", "/accounts", 401);
          await send(context, "POST", "/auth/2fa/verify", 401, { code });
        }
        const recoveryCode = charlie.recoveryCodes.shift();
        await Promise.all(
          pending.map((context) => send(context, "POST", "/auth/2fa/recover", [200, 401], { recoveryCode })),
        );
        const statuses = await Promise.all(pending.map((context) => send(context, "GET", "/auth/me", [200, 401])));
        assert.equal(statuses.filter((body) => body.user).length, 1);
        for (const context of pending) await context.dispose();
        pending.length = 0;
        await send(charlie.context, "POST", "/auth/2fa/disable", 204, {
          password: charlie.password,
          recoveryCode: charlie.recoveryCodes.shift(),
        });
        charlie.recoveryCodes = undefined;
      } finally {
        for (const context of pending) await context.dispose();
      }
    });
    await check("paired archive/create and category edit/create remain usable", async () => {
      for (let trial = 0; trial < 5; trial++) {
        const target = await account(alice, `Race ${trial}`);
        await Promise.all([
          entry(alice, { accountId: target.id }, [201, 409]),
          send(alice.context, "PATCH", `/accounts/${target.id}`, 200, { isArchived: true }),
        ]);
        await entry(alice, { accountId: target.id }, 409);
      }
      for (let trial = 0; trial < 5; trial++) {
        await send(alice.context, "PATCH", `/categories/${alice.category.id}`, 200, { types: ["expense"] });
        await Promise.all([
          entry(alice, { categoryId: alice.category.id }, [201, 400]),
          send(alice.context, "PATCH", `/categories/${alice.category.id}`, 200, { types: ["income"] }),
        ]);
      }
    });
    await check("profile deletion revokes stale cookies", async () => {
      const stale = await cloneSession(bob);
      try {
        await send(bob.context, "DELETE", "/auth/me", 204);
        bob.deleted = true;
        await send(stale, "GET", "/accounts", 401);
      } finally {
        await stale.dispose();
      }
    });
  }

  if (suite === "precision") {
    await check("aggregate balances retain exact minor units beyond a safe single amount", async () => {
      const target = await account(alice, "Precision", { openingBalanceMinor: Number.MAX_SAFE_INTEGER });
      await entry(alice, { accountId: target.id, type: "income", amountMinor: 2 });
      const balance = await send(alice.context, "GET", `/accounts/${target.id}/balance`, 200);
      const expected = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
      events.push({
        observation: "precision",
        expectedMinor: String(expected),
        actualMinor: String(balance.balanceMinor),
      });
      assert.equal(BigInt(balance.balanceMinor), expected, "Balance silently rounded by one minor unit");
    });
  }

  if (suite === "nul-text") {
    await check("NUL in a JSON text field is rejected without a server error", async () => {
      await send(alice.context, "POST", "/accounts", 400, { name: "before\u0000after", type: "checking" });
    });
  }

  if (suite === "timestamp") {
    await check("a parseable but unsupported historical timestamp is rejected", async () => {
      await entry(alice, { occurredAt: "-010000-01-01T00:00:00.000Z" }, 400);
    });
  }

  if (suite === "delete-race") {
    await check("category deletion versus transaction creation never produces a server error", async () => {
      const category = await send(alice.context, "POST", "/categories", 201, {
        name: "Delete race",
        types: ["expense"],
        icon: "shopping-cart",
        color: "#16A34A",
      });
      const results = await Promise.allSettled([
        entry(alice, { categoryId: category.id }, [201, 404]),
        send(alice.context, "DELETE", `/categories/${category.id}`, 204),
      ]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    });
  }

  if (suite === "upload-race") {
    await check("concurrent avatar replacements remain readable before profile cleanup", async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zQAAAABJRU5ErkJggg==",
        "base64",
      );
      for (let trial = 0; trial < 2; trial++) {
        await Promise.all(
          Array.from({ length: 2 }, () =>
            send(alice.context, "PUT", "/auth/me/avatar", 200, png, {
              headers: { "content-type": "image/png" },
            }),
          ),
        );
      }
      await send(alice.context, "GET", "/auth/me/avatar", 200);
      events.push({ observation: "avatar-storage-cleanup", expectedRemainingFilesAfterFixtureDeletion: 0 });
    });
  }

  if (suite === "avatar") {
    await check("avatar MIME, ownership and size boundaries", async () => {
      for (const data of [Buffer.alloc(0), Buffer.from("<svg/>")]) {
        await send(alice.context, "PUT", "/auth/me/avatar", 415, data, { headers: { "content-type": "image/png" } });
      }
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zQAAAABJRU5ErkJggg==",
        "base64",
      );
      await send(alice.context, "PUT", "/auth/me/avatar", 200, png, { headers: { "content-type": "image/png" } });
      await send(bob.context, "GET", "/auth/me/avatar", 404);
      await send(alice.context, "PUT", "/auth/me/avatar", 413, Buffer.alloc(5 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/png" },
      });
      await send(alice.context, "DELETE", "/auth/me/avatar", 204);
      await send(alice.context, "GET", "/auth/me/avatar", 404);
    });
    await check("signature-only image is rejected or decodes successfully", async () => {
      const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const context = alice.context;
      const before = events.length;
      await send(context, "PUT", "/auth/me/avatar", [200, 415], signature, {
        headers: { "content-type": "image/png" },
      });
      if (events[before].status === 200) {
        browser = await chromium.launch();
        const page = await browser.newPage();
        const decoded = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          try {
            await image.decode();
            return true;
          } catch {
            return false;
          }
        }, signature.toString("base64"));
        events.push({ observation: "signature-only-avatar", accepted: true, decoded });
        assert.ok(decoded, "Server accepted an eight-byte PNG signature that is not an image");
      }
    });
  }

  if (suite === "browser") {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    async function doubleClick(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(box, "Submit button must be visible");
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }
    try {
      const state = await alice.context.storageState();
      await context.addCookies(state.cookies);
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return [frontendUrl.origin, apiUrl.origin].includes(url.origin)
          ? route.continue()
          : route.abort("blockedbyclient");
      });
      page.setDefaultTimeout(navigationTimeoutMs);
      page.setDefaultNavigationTimeout(navigationTimeoutMs);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") events.push({ browserConsoleError: message.text() });
      });
      page.on("requestfailed", (request) => {
        events.push({ browserRequestFailure: request.url(), error: request.failure()?.errorText });
      });
      await check("main pages tolerate extreme URL filters and stale resource links", async () => {
        for (const path of [
          "/dashboard",
          "/accounts",
          "/categories",
          "/transactions?page=9007199254740991&pageSize=200",
          "/transactions?minAmountMinor=not-a-number&from=2026-02-29",
          `/transactions?accountId=${bob.account.id}`,
          "/analytics",
        ]) {
          const response = await page.goto(new URL(path, frontendUrl).href, { waitUntil: "networkidle" });
          assert.ok(response.status() < 500, `${path}: ${response.status()}`);
          assert.equal(await page.getByText("Application error", { exact: false }).count(), 0);
        }
        assert.deepEqual(pageErrors, []);
      });
      await check("account form rounds no decimals, cancels cleanly and blocks double clicks", async () => {
        await page.goto(new URL("/accounts", frontendUrl).href, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "New account", exact: true }).click();
        await page.getByLabel("Name", { exact: true }).fill("Browser account");
        await page.getByLabel("Opening balance", { exact: true }).fill("1.005");
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        assert.equal(
          (await send(alice.context, "GET", "/accounts", 200)).filter((row) => row.name === "Browser account").length,
          0,
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "New account", exact: true }).click();
        await page.getByLabel("Name", { exact: true }).fill("Browser account");
        await page.getByLabel("Opening balance", { exact: true }).fill("0.01");
        await doubleClick(page.getByRole("button", { name: "Create account", exact: true }));
        await page.getByRole("button", { name: "New account", exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        const created = (await send(alice.context, "GET", "/accounts", 200)).filter(
          (row) => row.name === "Browser account",
        );
        assert.equal(created.length, 1);
        assert.equal(created[0].openingBalanceMinor, 1);
        assert.deepEqual(pageErrors, []);
      });
      await check(
        "transaction dialog double submission writes once and import preview cancels without writes",
        async () => {
          await page.goto(new URL(`/transactions?accountId=${alice.account.id}`, frontendUrl).href, {
            waitUntil: "networkidle",
          });
          const before = (await list(alice)).total;
          await page.getByRole("button", { name: "New transaction", exact: true }).first().click();
          const dialog = page.getByRole("dialog");
          await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("0.01");
          await dialog.getByLabel("Description (optional)", { exact: true }).fill("Browser transaction");
          await doubleClick(dialog.getByRole("button", { name: "Add transaction", exact: true }));
          await dialog.waitFor({ state: "hidden" });
          await page.waitForLoadState("networkidle");
          assert.equal((await list(alice)).total, before + 1);
          await page.getByRole("button", { name: "Import JSON", exact: true }).click();
          await page.getByLabel("JSON file", { exact: true }).setInputFiles({
            name: "probe.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(document([importRow()]))),
          });
          await dialog.getByRole("heading", { name: "Preview (1 transactions)", exact: true }).waitFor();
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          assert.equal((await list(alice)).total, before + 1);
          assert.deepEqual(pageErrors, []);
        },
      );
    } catch (error) {
      events.push({ browserError: error.message, pageErrors });
      await writeFile(`${outputPath}.page.txt`, await page.locator("body").innerText(), { mode: 0o600 });
      await page.screenshot({ path: `${outputPath}.png`, fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }

  if (suite === "pressure") {
    await check("bounded incorrect-password attempts are rate limited", async () => {
      const anonymous = await newContext();
      try {
        for (let attempt = 0; attempt < 10; attempt++) {
          await send(anonymous, "POST", "/auth/login", 401, {
            email: alice.email,
            password: "deliberately-wrong-password",
          });
        }
        await send(anonymous, "POST", "/auth/login", 429, {
          email: alice.email,
          password: "deliberately-wrong-password",
        });
      } finally {
        await anonymous.dispose();
      }
    });
    await check("two-user mixed workload remains responsive and exact at two requests/second", async () => {
      const writeCounts = [0, 0];
      const initialTotals = await Promise.all(users.map(async (user) => (await list(user)).total));
      const requests = [];
      const inFlight = new Set();
      try {
        for (let index = 0; index < pressureDurationMs / pressureIntervalMs; index++) {
          if (inFlight.size >= 4) await Promise.race(inFlight);
          assert.ok(!stopped, "Pressure stopped after failed request");
          const userIndex = Math.floor(index / 4) % users.length;
          const user = users[userIndex];
          const operation = index % 4;
          if (operation === 0) writeCounts[userIndex]++;
          const task =
            operation === 0
              ? entry(user, { amountMinor: -7 })
              : operation === 1
                ? list(user, "&limit=25")
                : operation === 2
                  ? send(user.context, "GET", `/accounts/${user.account.id}/balance`, 200)
                  : send(
                      user.context,
                      "GET",
                      `/analytics/timeseries?from=2026-03-01&to=2026-03-31&granularity=day&accountId=${user.account.id}`,
                      200,
                    );
          requests.push(task);
          inFlight.add(task);
          task.then(
            () => inFlight.delete(task),
            () => inFlight.delete(task),
          );
          await delay(pressureIntervalMs);
        }
        await Promise.all(requests);
      } finally {
        await Promise.allSettled(requests);
      }
      for (const [index, user] of users.entries()) {
        assert.equal((await list(user)).total, initialTotals[index] + writeCounts[index]);
        const balance = await send(user.context, "GET", `/accounts/${user.account.id}/balance`, 200);
        assert.equal(balance.balanceMinor, -100 - writeCounts[index] * 7);
      }
    });
  }
  await health();
  completed = true;
} catch (error) {
  console.error(`STOP ${error.message.split("\n")[0]}`);
  events.push({ result: "stopped", error: error.message.split("\n")[0] });
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  for (const user of users) {
    try {
      if (user.id && !user.deleted) {
        const me = await send(user.context, "GET", "/auth/me", [200, 401]);
        if (!me.user) {
          const signedIn = await send(user.context, "POST", "/auth/login", 200, {
            email: user.email,
            password: user.password,
          });
          if (signedIn.twoFactorRequired) {
            assert.ok(user.recoveryCodes?.length, "No recovery code available for fixture cleanup");
            await send(user.context, "POST", "/auth/2fa/recover", 200, { recoveryCode: user.recoveryCodes.shift() });
          }
        }
        await send(user.context, "DELETE", "/auth/me", 204);
        await send(user.context, "GET", "/auth/me", 401);
      }
    } catch (error) {
      events.push({ cleanup: "failed", fixtureId: user.id, error: error.message.split("\n")[0] });
      console.error(`Cleanup failed for fixture ${user.id}: ${error.message.split("\n")[0]}`);
      process.exitCode = 1;
    } finally {
      await user.context.dispose();
    }
  }
  if (browser) await browser.close();
  const workload = events.filter((event) => event.phase === "workload" && event.durationMs !== undefined);
  const durations = workload.map((event) => event.durationMs).sort((a, b) => a - b);
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        suite,
        runId,
        completed,
        workloadRequests,
        timing: {
          maximumMs: durations.at(-1),
          medianMs: durations[Math.floor(durations.length / 2)],
          p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
        },
        events,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(`Evidence: ${outputPath}`);
}
