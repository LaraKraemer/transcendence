import cookieParser from "cookie-parser";
import cors from "cors";
import { DrizzleQueryError } from "drizzle-orm";
import express from "express";

import { pool } from "./db/client.ts";
import { createAuthRateLimiter, createLoginRateLimiter } from "./rate-limit.ts";
import { accountsRouter } from "./routes/account.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/category.ts";
import { transactionsRouter } from "./routes/transaction.ts";

export function createApp() {
  const app = express();
  const authRateLimiter = createAuthRateLimiter();
  const loginRateLimiter = createLoginRateLimiter();
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined) {
    const hops = Number(trustProxy);
    if (!Number.isSafeInteger(hops) || hops < 0) {
      throw new Error("TRUST_PROXY must be a non-negative proxy hop count");
    }
    app.set("trust proxy", hops);
  }

  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
  app.post("/auth/register", authRateLimiter);
  app.post("/auth/login", authRateLimiter, loginRateLimiter);
  app.use("/accounts", accountsRouter);
  app.use("/auth", authRouter);
  app.use("/categories", categoriesRouter);
  app.use("/transactions", transactionsRouter);

  app.get("/", (_, res) => {
    res.send("Expense Tracker API");
  });

  app.get("/health", async (_, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", db: "ok" });
    } catch (error) {
      console.error("Health check failed:", error);
      res.status(503).json({ status: "error", db: "unreachable" });
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof Error && "type" in error) {
      if (error.type === "entity.parse.failed") {
        res.status(400).json({ error: "Malformed JSON" });
        return;
      }
      if (error.type === "entity.too.large") {
        res.status(413).json({ error: "Request body too large" });
        return;
      }
    }
    if (error instanceof DrizzleQueryError) {
      const cause = error.cause;
      const postgresError =
        typeof cause === "object" && cause !== null
          ? (cause as { code?: unknown; constraint?: unknown; message?: unknown })
          : undefined;
      console.error("Database query failed", {
        query: error.query,
        ...(typeof postgresError?.code === "string" ? { code: postgresError.code } : {}),
        ...(typeof postgresError?.constraint === "string" ? { constraint: postgresError.constraint } : {}),
        ...(typeof postgresError?.message === "string" ? { message: postgresError.message } : {}),
      });
    } else {
      console.error("Unhandled request error:", error);
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
