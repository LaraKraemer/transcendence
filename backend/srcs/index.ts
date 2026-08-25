import "dotenv/config";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { 
	and, 
	eq, 
	isNull 
} from "drizzle-orm";
import { accountsRouter } from "./routes/account.ts";

import {
	clearSessionCookie,
  createSession,
  getAuthenticatedUserId,
  hashPassword,
  revokeCurrentSession,
  verifyPassword,
} from "./auth.ts";
import { 
	db, 
	pool 
} from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { appUsers } from "./db/schema.ts";
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

// Registers a new local user and immediately starts a browser session.
app.post("/auth/register", async (req, res, next) => {
  const { email, password, displayName } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    res.status(400).json({ error: "Password must be 12 to 72 bytes" });
    return;
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.trim().length > 100) {
    res.status(400).json({ error: "displayName must be between 1 and 100 characters" });
    return;
  }

  try {
    const [existingUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.email, normalizedEmail))
      .limit(1);
    if (existingUser) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const [user] = await db
      .insert(appUsers)
      .values({
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        displayName: displayName.trim(),
      })
      .returning({ id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName });

    if (!user) throw new Error("User creation did not return a user");
    await createSession(req, res, user.id);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

// Verifies local credentials and starts a new browser session.
app.post("/auth/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || typeof password !== "string") {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.email, normalizedEmail), isNull(appUsers.deletedAt)))
      .limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    await createSession(req, res, user.id);
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (error) {
    next(error);
  }
});

// Revokes the current server-side session and clears its browser cookie.
app.post("/auth/logout", async (req, res, next) => {
  try {
    await revokeCurrentSession(req);
    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Returns the user associated with the request's active session cookie.
app.get("/auth/me", async (req, res, next) => {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [user] = await db
      .select({ id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);
    res.json({ user });
  } catch (error) {
    next(error);
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
