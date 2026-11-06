import cookieParser from "cookie-parser";
import cors from "cors";
import { DrizzleQueryError } from "drizzle-orm";
import express from "express";

import { requireAuthenticatedUser, requirePendingSession } from "./auth.ts";
import { pool } from "./db/client.ts";
import { captureMetricsRoutePrefix, measureHttpRequests } from "./metrics.ts";
import { createAuthRateLimiter, createLoginRateLimiter, createTwoFactorRateLimiter } from "./rate-limit.ts";
import { accountsRouter } from "./routes/account.ts";
import { analyticsRouter } from "./routes/analytics.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/category.ts";
import { currenciesRouter } from "./routes/currency.ts";
import { transactionsRouter } from "./routes/transaction.ts";
import { getStatus } from "./status.ts";
import { TRANSACTION_IMPORT_MAX_BYTES } from "./transaction-import.ts";

export function createApp() {
  const app = express();
  const authRateLimiter = createAuthRateLimiter();
  const loginRateLimiter = createLoginRateLimiter();
  const twoFactorRateLimiter = createTwoFactorRateLimiter();
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined) {
    const hops = Number(trustProxy);
    if (!Number.isSafeInteger(hops) || hops < 0) {
      throw new Error("TRUST_PROXY must be a non-negative proxy hop count");
    }
    app.set("trust proxy", hops);
  }

  app.use(measureHttpRequests);
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.post("/transactions/import", requireAuthenticatedUser, express.json({ limit: TRANSACTION_IMPORT_MAX_BYTES }));
  app.use(express.json());
  app.post("/auth/register", authRateLimiter);
  app.post("/auth/login", authRateLimiter, loginRateLimiter);
  app.post("/auth/google", authRateLimiter);
  // The limiter keys on the user, so it runs after the same session check the routes use.
  app.post(["/auth/2fa/verify", "/auth/2fa/recover"], requirePendingSession, twoFactorRateLimiter);
  app.post(["/auth/2fa/enable", "/auth/2fa/disable"], requireAuthenticatedUser, twoFactorRateLimiter);
  app.use("/accounts", captureMetricsRoutePrefix, accountsRouter);
  app.use("/analytics", captureMetricsRoutePrefix, analyticsRouter);
  app.use("/auth", captureMetricsRoutePrefix, authRouter);
  app.use("/categories", captureMetricsRoutePrefix, categoriesRouter);
  app.use("/currencies", captureMetricsRoutePrefix, currenciesRouter);
  app.use("/transactions", captureMetricsRoutePrefix, transactionsRouter);

  app.get("/", (_, res) => {
    res.send("Expense Tracker API");
  });

  /** Public operational status; component failures contain no internal details. */
  app.get("/status", async (_, res) => {
    res.set("Cache-Control", "no-store").json(await getStatus());
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
