import "dotenv/config";

import { purgeStaleSessions } from "./auth.ts";
import { createApp } from "./app.ts";
import { pool } from "./db/client.ts";
import { createMetricsApp } from "./metrics.ts";
import { runMigrations } from "./db/migrate.ts";

// Run session cleanup every six hours.
const SESSION_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

await runMigrations();
console.log("Migrations applied");

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
