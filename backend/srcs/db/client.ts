import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Inside Docker it comes from docker-compose.yml; " +
      "running locally, put it in backend/.env",
  );
}

export const pool = new pg.Pool({ connectionString: databaseUrl });

// Keep status deadlines and connection usage separate from application requests.
const statusTimeoutMs = 3000;
export const statusPool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: statusTimeoutMs,
  query_timeout: statusTimeoutMs,
});
statusPool.on("error", () => {
  console.error("Unexpected status database connection error");
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export const db = drizzle(pool, { schema });
