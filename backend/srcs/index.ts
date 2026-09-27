import "dotenv/config";

import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";

await runMigrations();
console.log("Migrations applied");

createApp().listen(3001, () => {
  console.log("Server running on port 3001");
});
