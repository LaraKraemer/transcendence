import { createHash, randomBytes, randomUUID } from "node:crypto";

import express, { Router } from "express";

import {
  clearSessionCookie,
  createSession,
  getAuthenticatedUserId,
  hashPassword,
  revokeCurrentSession,
  requireAuthenticatedUser,
  verifyPassword,
} from "../auth.ts";
import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserPasswordHash,
  updateUserAvatarUrl,
  updateUserPassword,
  updateUserProfile,
} from "../db/users.ts";
import { deleteAvatar, readAvatar, writeAvatar } from "../storage.ts";
import { isJpegOrPng, isValidPassword, parseRequiredText, TEXT_LIMITS } from "../validation.ts";

export const authRouter = Router();
const avatarMaxBytes = 5 * 1024 * 1024;
const avatarRoute = "/auth/me/avatar";

/**
 * Replaces the stored avatar key with the retrieval route so storage details never reach clients.
 * `v` is a hash of the key, which is new for every upload, so clients never show a stale cached photo.
 */
function toPublicUser<User extends { avatarUrl: string | null }>(user: User) {
  const version = user.avatarUrl && createHash("sha256").update(user.avatarUrl).digest("hex").slice(0, 16);
  return { ...user, avatarUrl: user.avatarUrl ? `${avatarRoute}?v=${version}` : null };
}

// Unknown emails must do the same bcrypt work as a wrong password for an existing user.
const dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

// Registers a new local user and immediately starts a browser session.
authRouter.post("/register", async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (normalizedEmail.length > TEXT_LIMITS.email || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: "Password must be 12 to 72 bytes" });
    return;
  }
  const displayNameText = parseRequiredText(displayName, TEXT_LIMITS.displayName);
  if (displayNameText === undefined) {
    res.status(400).json({ error: `displayName must be between 1 and ${TEXT_LIMITS.displayName} characters` });
    return;
  }

  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const user = await createUser(normalizedEmail, await hashPassword(password), displayNameText);
  if (!user) throw new Error("User creation did not return a user");
  await createSession(req, res, user.id);
  res.status(201).json({ user: { ...user, avatarUrl: null } });
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
  res.json({
    user: toPublicUser({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    }),
  });
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
  res.json({ user: user && toPublicUser(user) });
});

/** Permanently deletes the authenticated profile and signs out every device. */
authRouter.delete("/me", requireAuthenticatedUser, async (_req, res, next) => {
  try {
    const userId = res.locals.userId as string;
    const user = await findUserById(userId);
    await deleteUser(userId);
    if (user?.avatarUrl) deleteAvatar(user.avatarUrl).catch(() => {});
    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Updates the authenticated user's display name. */
authRouter.patch("/me", requireAuthenticatedUser, async (req, res, next) => {
  const body = req.body ?? {};
  if (!Object.hasOwn(body, "displayName")) {
    res.status(400).json({ error: "No editable field provided" });
    return;
  }
  const { displayName } = body;
  const displayNameText = parseRequiredText(displayName, TEXT_LIMITS.displayName);
  if (displayNameText === undefined) {
    res.status(400).json({ error: `displayName must be between 1 and ${TEXT_LIMITS.displayName} characters` });
    return;
  }
  try {
    const user = await updateUserProfile(res.locals.userId as string, { displayName: displayNameText });
    res.json({ user: user && toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

/** Uploads or replaces the authenticated user's profile image (raw JPEG or PNG request body). */
authRouter.put(
  "/me/avatar",
  requireAuthenticatedUser,
  express.raw({ type: ["image/jpeg", "image/png"], limit: avatarMaxBytes }),
  async (req, res, next) => {
    const image: unknown = req.body;
    const mimeType = Buffer.isBuffer(image) ? isJpegOrPng(image) : null;
    if (!Buffer.isBuffer(image) || mimeType === null) {
      res.status(415).json({ error: "Body must be a JPEG or PNG image" });
      return;
    }

    let newKey: string | undefined;
    let isSaved = false;
    try {
      const userId = res.locals.userId as string;
      const oldUser = await findUserById(userId);
      if (!oldUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // tradeoff: two simultaneous uploads by one user can orphan a file; fix with a row lock or a sweep.
      const fileExtension = mimeType === "image/jpeg" ? ".jpg" : ".png";
      newKey = `${randomUUID()}${fileExtension}`;
      await writeAvatar(newKey, image);
      await updateUserAvatarUrl(userId, newKey);
      isSaved = true;

      if (oldUser.avatarUrl) deleteAvatar(oldUser.avatarUrl).catch(() => {});
      res.json({ user: toPublicUser({ ...oldUser, avatarUrl: newKey }) });
    } catch (error) {
      // Once the database points at newKey, the file must survive any later failure.
      if (newKey && !isSaved) deleteAvatar(newKey).catch(() => {});
      next(error);
    }
  },
);

/** Returns the authenticated user's profile image. */
authRouter.get("/me/avatar", requireAuthenticatedUser, async (req, res, next) => {
  try {
    const userId = res.locals.userId as string;
    const user = await findUserById(userId);
    if (!user?.avatarUrl) {
      res.status(404).json({ error: "No avatar set" });
      return;
    }
    const buffer = await readAvatar(user.avatarUrl);
    if (!buffer) {
      res.status(404).json({ error: "Avatar file not found" });
      return;
    }
    const contentType = user.avatarUrl.endsWith(".jpg") ? "image/jpeg" : "image/png";
    res.set("Cache-Control", "private, no-cache").type(contentType).send(buffer);
  } catch (error) {
    next(error);
  }
});

/** Removes the authenticated user's profile image. */
authRouter.delete("/me/avatar", requireAuthenticatedUser, async (req, res, next) => {
  try {
    const userId = res.locals.userId as string;
    const user = await findUserById(userId);
    await updateUserAvatarUrl(userId, null);
    if (user?.avatarUrl) deleteAvatar(user.avatarUrl).catch(() => {});
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Verifies the current password, changes it, and signs out every device. */
authRouter.patch("/password", requireAuthenticatedUser, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "currentPassword and newPassword must be strings" });
    return;
  }
  if (!isValidPassword(newPassword)) {
    res.status(400).json({ error: "Password must be 12 to 72 bytes" });
    return;
  }

  try {
    const userId = res.locals.userId as string;
    const previousHash = await findUserPasswordHash(userId);
    if (!previousHash || !(await verifyPassword(currentPassword, previousHash))) {
      res.status(401).json({ error: "Invalid current password" });
      return;
    }
    if (!(await updateUserPassword(userId, previousHash, await hashPassword(newPassword)))) {
      res.status(401).json({ error: "Invalid current password" });
      return;
    }
    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
