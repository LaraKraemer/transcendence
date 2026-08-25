import "dotenv/config";

import cors from "cors";
import express from "express";

import { pool } from "./db/client.ts";
import { db } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { expenses } from "./db/schema.ts";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

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

app.get("/expenses", async (_, res) => {
  const rows = await db.select().from(expenses);
  res.json(rows);
});

app.post("/expenses", async (req, res) => {
  const { description, amountCents, category } = req.body ?? {};

  if (typeof description !== "string" || description.trim() === "") {
    res.status(400).json({ error: "description must be a non-empty string" });
    return;
  }

  if (!Number.isInteger(amountCents)) {
    res.status(400).json({ error: "amountCents must be an integer (cents)" });
    return;
  }

  if (category !== undefined && typeof category !== "string") {
    res.status(400).json({ error: "category must be a string when provided" });
    return;
  }

  // exactOptionalPropertyTypes forbids passing `category: undefined`
  // explicitly, so the key is only spread in when it is actually present.
  const [created] = await db
    .insert(expenses)
    .values({
      description: description.trim(),
      amountCents,
      ...(category === undefined ? {} : { category }),
    })
    .returning();

  res.status(201).json(created);
});

// Migrate before listening so the server never serves an unmigrated schema.
await runMigrations();
console.log("Migrations applied");

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
