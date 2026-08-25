import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Inside Docker it comes from docker-compose.yml; " +
      "running locally, put it in backend/.env",
  );
}

export default {
  schema: "./srcs/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
} satisfies Config;
