import "dotenv/config";

import { purgeStaleSessions } from "./auth.ts";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";

// Run session cleanup every six hours.
const SESSION_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

await runMigrations();
console.log("Migrations applied");

createApp().listen(3001, () => {
  console.log("Server running on port 3001");
});

const runPurge = () => purgeStaleSessions().catch((error) => console.error("Session purge failed:", error));
void runPurge();
setInterval(runPurge, SESSION_PURGE_INTERVAL_MS).unref();
