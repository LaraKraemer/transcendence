import "dotenv/config";

import { isNotNull } from "drizzle-orm";

import { purgeStaleSessions } from "./auth.ts";
import { createApp } from "./app.ts";
import { db, pool } from "./db/client.ts";
import { createMetricsApp } from "./metrics.ts";
import { runMigrations } from "./db/migrate.ts";
import { appUsers } from "./db/schema.ts";
import { isTwoFactorConfigured } from "./totp.ts";

// Run session cleanup every six hours.
const SESSION_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

await runMigrations();
console.log("Migrations applied");

// A malformed key already throws in isTwoFactorConfigured. Without a key, users who enabled 2FA could never log in.
if (!isTwoFactorConfigured()) {
  const [twoFactorUser] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(isNotNull(appUsers.totpEnabledAt))
    .limit(1);
  if (twoFactorUser) throw new Error("TOTP_ENCRYPTION_KEY must be set: some users have two-factor authentication on");
}

createApp().listen(3001, () => {
  console.log("Server running on port 3001");
});

const metricsPort = 9100;
createMetricsApp(pool).listen(metricsPort, "0.0.0.0", () => {
  console.log(`Internal metrics server running on port ${metricsPort}`);
});

const runPurge = () => purgeStaleSessions().catch((error) => console.error("Session purge failed:", error));
void runPurge();
setInterval(runPurge, SESSION_PURGE_INTERVAL_MS).unref();
