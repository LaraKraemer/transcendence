import { randomBytes } from "node:crypto";

import { Router } from "express";

import {
  clearSessionCookie,
  createSession,
  getAuthenticatedUserId,
  hashPassword,
  revokeCurrentSession,
  verifyPassword,
} from "../auth.ts";
import { createUser, findUserByEmail, findUserById } from "../db/users.ts";

export const authRouter = Router();
// Unknown emails must do the same bcrypt work as a wrong password for an existing user.
const dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

// Registers a new local user and immediately starts a browser session.
authRouter.post("/register", async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    res.status(400).json({ error: "Password must be 12 to 72 bytes" });
    return;
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.trim().length > 100) {
    res.status(400).json({ error: "displayName must be between 1 and 100 characters" });
    return;
  }

  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const user = await createUser(normalizedEmail, await hashPassword(password), displayName.trim());
  if (!user) throw new Error("User creation did not return a user");
  await createSession(req, res, user.id);
  res.status(201).json({ user });
});

// Verifies local credentials and starts a new browser session.
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || typeof password !== "string") {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    await verifyPassword(password, await dummyPasswordHash);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await createSession(req, res, user.id);
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
});

// Revokes the current server-side session and clears its browser cookie.
authRouter.post("/logout", async (req, res) => {
  await revokeCurrentSession(req);
  clearSessionCookie(res);
  res.status(204).send();
});

// Returns the user associated with the request's active session cookie.
authRouter.get("/me", async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await findUserById(userId);
  res.json({ user });
});
