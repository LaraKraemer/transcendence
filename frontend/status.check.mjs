// Run against the frontend: node status.check.mjs. Backend responses are simulated.
// Accessibility and layout are covered separately by npm run check:a11y.
import assert from "node:assert/strict";

import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.install();
  let health = "ok";
  let unreachable = false;
  let requests = 0;
  let hanging = false;
  let storageDown = false;
  let releaseInitialRequest;
  const initialRequestGate = new Promise((resolve) => {
    releaseInitialRequest = resolve;
  });
  await page.route("**/status", async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    requests++;
    await initialRequestGate;
    if (hanging) return;
    if (unreachable) return route.abort();
    return route.fulfill({
      json: {
        status: health,
        components: {
          database: { status: health === "down" ? "down" : "ok" },
          storage: { status: storageDown ? "down" : "ok" },
        },
        lastBackupAt: health === "degraded" ? null : "2026-11-02T09:00:00.000Z",
      },
    });
  });
  const origin = process.env.FRONTEND_URL ?? "https://localhost:3000";
  const { default: messages } = await import("./messages/en.json", { with: { type: "json" } });
  const t = messages.systemStatus;
  async function checkStatuses(overall, database, storage) {
    for (const [label, status] of [
      [t.overall, overall],
      [t.database, database],
      [t.storage, storage],
    ]) {
      await page
        .getByRole("status")
        .locator("dl > div")
        .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
        .locator("dd")
        .getByText(t[status], { exact: true })
        .waitFor();
    }
  }

  await page.context().addCookies([
    { name: "locale", value: "en", url: origin },
    { name: "theme", value: "light", url: origin },
  ]);
  health = "ok";
  unreachable = true;
  await page.goto(`${origin}/status?from=register`);
  await page.getByText(t.loading, { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: t.pause, exact: true }).count(),
    0,
    "cannot pause before the first response",
  );
  assert.equal(
    await page.getByRole("banner").getByRole("link").getAttribute("href"),
    "/register",
    "return link preserves registration context",
  );
  releaseInitialRequest();
  await page.getByRole("status").filter({ hasText: t.unreachable }).waitFor();
  unreachable = false;
  await page.clock.fastForward(30_000);
  await checkStatuses("ok", "ok", "ok");
  const initialRequests = requests;
  health = "down";
  await page.clock.fastForward(30_000);
  await checkStatuses("down", "down", "ok");
  assert.ok(requests > initialRequests, "refreshes after 30 seconds");
  storageDown = true;
  await page.clock.fastForward(30_000);
  await checkStatuses("down", "down", "down");
  storageDown = false;
  health = "degraded";
  await page.clock.fastForward(30_000);
  await checkStatuses("degraded", "ok", "ok");
  await page.getByText(t.noBackup, { exact: true }).waitFor();
  unreachable = true;
  await page.clock.fastForward(30_000);
  await page.getByRole("status").filter({ hasText: t.unreachable }).waitFor();
  assert.equal(await page.locator("dl").count(), 0, "discards stale results");
  unreachable = false;
  health = "ok";
  await page.clock.fastForward(30_000);
  await checkStatuses("ok", "ok", "ok");
  await page.getByRole("button", { name: t.pause, exact: true }).click();
  await page.getByRole("status").getByText(t.paused, { exact: true }).waitFor();
  const pausedRequests = requests;
  await page.clock.fastForward(60_000);
  assert.equal(requests, pausedRequests, "pause stops requests");
  health = "down";
  const resumedResponse = page.waitForResponse(
    (response) => response.request().resourceType() === "fetch" && response.url().endsWith("/status"),
  );
  await page.getByRole("button", { name: t.resume, exact: true }).click();
  await resumedResponse;
  await page.getByRole("status").getByText(t.refresh, { exact: true }).waitFor();
  await checkStatuses("down", "down", "ok");
  hanging = true;
  const pendingRequest = page.waitForRequest(
    (request) => request.resourceType() === "fetch" && request.url().endsWith("/status"),
  );
  await page.clock.fastForward(30_000);
  await pendingRequest;
  await page.clock.fastForward(10_000);
  await page.getByRole("status").filter({ hasText: t.unreachable }).waitFor();
  hanging = false;
  health = "ok";
  await page.clock.fastForward(30_000);
  await checkStatuses("ok", "ok", "ok");
  console.log("Status checks: refresh, pause/resume, outages, timeout and recovery passed");
} finally {
  await browser.close();
}
