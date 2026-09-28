import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { pool } from "./db/client.ts";
import { accountsRouter } from "./routes/account.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/category.ts";
import { transactionsRouter } from "./routes/transaction.ts";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
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

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("Unhandled request error:", error);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
