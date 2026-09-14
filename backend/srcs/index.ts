import "dotenv/config";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { pool } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { accountsRouter } from "./routes/account.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/category.ts";
import { transactionsRouter } from "./routes/transaction.ts";

const app = express();
const PORT = 3001;

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

// Actually queries the database. Previously this returned "ok"
// unconditionally, which would report healthy against a dead DB.
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
  console.error("Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// Migrate before listening so the server never serves an unmigrated schema.
await runMigrations();
console.log("Migrations applied");

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
