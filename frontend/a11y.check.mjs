// Accessibility scan: signs up a throwaway user, seeds a little data through the
// API, then runs axe (WCAG 2.1 A/AA rules) on every page and the main dialogs in
// light and dark, in English and Persian (RTL), at desktop width and at 320 px.
// Fails on serious or critical violations, and on pages that scroll sideways at
// 320 px (WCAG 1.4.10 reflow; a table may scroll inside its own region), also
// with the 1.4.12 text spacing applied.
// Needs the running stack (`make up`).
//
//   npm run check:a11y                      # against http://localhost:3000 / :3001
//   FRONTEND_URL=… API_URL=… npm run check:a11y
import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
const apiUrl = process.env.API_URL ?? "http://localhost:3001";
const failingImpacts = new Set(["serious", "critical"]);
// The WCAG 1.4.12 minimums: content must still fit with these overrides.
const textSpacingCss =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }" +
  " p { margin-bottom: 2em !important; }";
const viewports = { desktop: { width: 1280, height: 800 }, phone: { width: 320, height: 640 } };

const publicPages = ["/login", "/register", "/privacy", "/terms", "/no-such-page"];
const protectedPages = [
  "/dashboard",
  "/accounts",
  "/accounts?archived=true",
  "/transactions",
  "/categories",
  "/profile",
];

// Each opens one dialog (or inline form) by its button's accessible name in the current locale.
const dialogs = [
  { path: "/accounts", button: (m) => m.accounts.newAccount },
  { path: "/accounts", button: (m) => m.accounts.actions.edit.replace("{name}", "Checking") },
  { path: "/accounts", button: (m) => m.accounts.actions.archive.replace("{name}", "Checking") },
  { path: "/categories", button: (m) => m.categories.newCategory },
  { path: "/categories", button: (m) => m.categories.actions.edit.replace("{name}", "Groceries") },
  { path: "/categories", button: (m) => m.categories.actions.delete.replace("{name}", "Groceries") },
  { path: "/transactions", button: (m) => m.transactions.newTransaction },
  { path: "/transactions", button: (m) => m.transactions.edit.replace("{description}", "Weekly shop") },
  { path: "/transactions", button: (m) => m.transactions.delete.replace("{description}", "Weekly shop") },
  { path: "/profile", button: (m) => m.profile.edit },
];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Sign up through the API; the backend's session cookie is host-scoped, so it also counts for the frontend.
const register = await context.request.post(`${apiUrl}/auth/register`, {
  data: { email: `a11y-${Date.now()}@example.com`, password: "a11y-check-password", displayName: "Axe Check" },
});
if (!register.ok()) throw new Error(`register failed: ${register.status()} ${await register.text()}`);
const post = async (path, data) => (await context.request.post(`${apiUrl}${path}`, { data })).json();
const checking = await post("/accounts", { name: "Checking", type: "checking", openingBalanceMinor: 100000 });
const savings = await post("/accounts", { name: "Savings", type: "savings", openingBalanceMinor: 0 });
const groceries = await post("/categories", {
  name: "Groceries",
  icon: "shopping-cart",
  color: "#16A34A",
  types: ["expense"],
});
const today = new Date().toISOString().slice(0, 10);
await post("/transactions", {
  accountId: checking.id,
  type: "expense",
  categoryId: groceries.id,
  amountMinor: -4250,
  description: "Weekly shop",
  bookedOn: today,
});
await post("/transactions", { accountId: checking.id, type: "income", amountMinor: 250000, bookedOn: today });
await post("/transactions/transfers", {
  fromAccountId: checking.id,
  toAccountId: savings.id,
  fromAmountMinor: 2500,
  toAmountMinor: 2500,
  bookedOn: today,
});
const cash = await post("/accounts", { name: "Old wallet", type: "cash", openingBalanceMinor: 0 });
await context.request.patch(`${apiUrl}/accounts/${cash.id}`, { data: { isArchived: true } });
const sessionCookies = await context.cookies(apiUrl);

let failures = 0;
let scans = 0;

async function scan(label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  scans++;
  for (const violation of violations.filter((v) => failingImpacts.has(v.impact))) {
    failures++;
    console.error(`✗ ${label}: [${violation.impact}] ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes.slice(0, 5))
      console.error(`    ${node.target.join(" ")}\n      ${node.failureSummary.replaceAll("\n", "\n      ")}`);
  }
  for (const spacing of ["", " with text spacing"]) {
    if (spacing) await page.addStyleTag({ content: textSpacingCss });
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflowPx > 0) {
      failures++;
      console.error(`✗ ${label}: page scrolls sideways by ${overflowPx}px${spacing}`);
    }
  }
}

// Deletes the throwaway user (and its data) even when a page fails to load.
try {
  for (const theme of ["light", "dark"]) {
    for (const locale of ["en", "fa"]) {
      const messages = JSON.parse(readFileSync(new URL(`./messages/${locale}.json`, import.meta.url), "utf8"));
      const settings = [
        { name: "theme", value: theme, url: frontendUrl },
        { name: "locale", value: locale, url: frontendUrl },
      ];
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        await page.setViewportSize(viewport);
        const pages = [...publicPages, ...protectedPages, ...(viewportName === "phone" ? ["/more"] : [])];
        for (const path of pages) {
          await context.clearCookies();
          await context.addCookies(publicPages.includes(path) ? settings : [...settings, ...sessionCookies]);
          await page.goto(`${frontendUrl}${path}`, { waitUntil: "networkidle" });
          await scan(`${path} (${theme}, ${locale}, ${viewportName})`);
        }
        for (const dialog of dialogs) {
          await page.goto(`${frontendUrl}${dialog.path}`, { waitUntil: "networkidle" });
          const formsBefore = await page.locator("form").count();
          await page
            .getByRole("button", { name: dialog.button(messages), exact: true })
            .first()
            .click();
          await page.waitForFunction(
            (count) => document.querySelector("dialog[open]") || document.forms.length > count,
            formsBefore,
          );
          await scan(`${dialog.path} dialog "${dialog.button(messages)}" (${theme}, ${locale}, ${viewportName})`);
        }
      }
    }
  }
} finally {
  await context.request.delete(`${apiUrl}/auth/me`);
  await browser.close();
}
console.log(`${scans} scans, ${failures} failures`);
if (failures > 0) process.exit(1);
