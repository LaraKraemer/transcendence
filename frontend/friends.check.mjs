// With the stack running: cd frontend && NODE_EXTRA_CA_CERTS=../nginx/certs/ca/rootCA.pem node friends.check.mjs
import assert from "node:assert/strict";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const apiUrl = process.env.API_URL ?? "https://localhost:8443";
const frontendUrl = process.env.FRONTEND_URL ?? "https://localhost:3000";
const browser = await chromium.launch();
const contexts = [await browser.newContext(), await browser.newContext()];
const emails = contexts.map((_, index) => `friends-check-${index}-${crypto.randomUUID()}@example.com`);

try {
  for (const [index, context] of contexts.entries()) {
    const response = await context.request.post(`${apiUrl}/auth/register`, {
      data: { email: emails[index], password: "friends-check-password", displayName: `Check ${index}` },
    });
    assert.equal(response.status(), 201, await response.text());
  }
  const [aliceContext, bobContext] = contexts;
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const failedFriendsRequests = [];
  alice.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/friends") {
      failedFriendsRequests.push(request.failure()?.errorText);
    }
  });
  await alice.clock.install();
  await alice.goto(`${frontendUrl}/profile`);
  await bob.goto(`${frontendUrl}/profile`);
  await alice.getByRole("heading", { name: "Sent requests" }).waitFor();
  assert.deepEqual(failedFriendsRequests, [], "initial friends loading should not cancel requests");
  await alice.getByRole("textbox", { name: "Friend's email address" }).fill("friends-check-missing@example.com");
  await alice.getByRole("button", { name: "Send request" }).click();
  await alice.getByText("No user found").waitFor();
  await alice.getByRole("textbox", { name: "Friend's email address" }).fill(emails[1]);
  await alice.getByRole("button", { name: "Send request" }).click();
  await alice.getByRole("heading", { name: "Sent requests" }).locator("..").getByText(emails[1]).waitFor();

  await bob.reload();
  const incoming = bob.getByRole("heading", { name: "Incoming requests" }).locator("..");
  await incoming.getByText(emails[0]).waitFor();
  assert.equal(await incoming.getByText("Online").count(), 0);
  const pendingViolations = (await new AxeBuilder({ page: bob }).analyze()).violations;
  assert.equal(pendingViolations.filter(({ impact }) => ["serious", "critical"].includes(impact)).length, 0);

  await incoming.getByRole("button", { name: "Accept" }).click();
  await bob.getByRole("heading", { name: "Friends", level: 3 }).locator("..").getByText("Online").waitFor();
  await alice.reload();
  const accepted = alice.getByRole("heading", { name: "Friends", level: 3 }).locator("..");
  await accepted.getByText("Online").waitFor();
  const acceptedViolations = (await new AxeBuilder({ page: alice }).analyze()).violations;
  assert.equal(acceptedViolations.filter(({ impact }) => ["serious", "critical"].includes(impact)).length, 0);

  await aliceContext.addCookies([{ name: "theme", value: "dark", url: frontendUrl }]);
  await alice.reload();
  await accepted.getByText("Online").waitFor();
  const darkViolations = (await new AxeBuilder({ page: alice }).analyze()).violations;
  assert.equal(darkViolations.filter(({ impact }) => ["serious", "critical"].includes(impact)).length, 0);

  let polls = 0;
  alice.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/friends") polls++;
  });
  await alice.bringToFront();
  await alice.clock.runFor(60_100);
  assert.ok(polls >= 1, "visible profile should poll within one minute");
  await alice.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const beforeHidden = polls;
  await alice.clock.runFor(60_100);
  assert.equal(polls, beforeHidden, "hidden profile should not poll");
  await alice.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await alice.waitForResponse((response) => new URL(response.url()).pathname === "/friends");
  assert.ok(polls > beforeHidden, "visible profile should refresh immediately");
  await accepted.getByRole("button", { name: "Remove friend" }).click();
  await accepted.getByText("None yet").waitFor();
  console.log("friends UI, accessibility and visible-only polling: ok");
} finally {
  for (const context of contexts) {
    const response = await context.request.delete(`${apiUrl}/auth/me`);
    if (response.status() !== 204 && response.status() !== 401) {
      console.error(`friends check cleanup failed: ${response.status()}`);
    }
    await context.close();
  }
  await browser.close();
}
