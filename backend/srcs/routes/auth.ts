import { createHash, randomBytes, randomUUID } from "node:crypto";

import express, { Router } from "express";
import type { Request, Response } from "express";

import {
  clearSessionCookie,
  completePendingSession,
  createSession,
  exchangeGoogleCode,
  getAuthenticatedUserId,
  hashPassword,
  revokeCurrentSession,
  requireAuthenticatedUser,
  requirePendingSession,
  verifyPassword,
} from "../auth.ts";
import {
  activateTotp,
  burnRecoveryCode,
  claimTotpStep,
  deactivateTotp,
  findTotpState,
  saveTotpSecret,
} from "../db/twofactor.ts";
import {
  createUser,
  createUserWithIdentity,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserByIdentity,
  findUserPasswordHash,
  linkIdentity,
  updateUserAvatarUrl,
  updateUserPassword,
  updateUserProfile,
} from "../db/users.ts";
import { deleteAvatar, readAvatar, writeAvatar } from "../storage.ts";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  isTwoFactorConfigured,
  otpauthUri,
  verifyTotp,
} from "../totp.ts";
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

/**
 * Starts a session for a user who just proved their identity. When the user has 2FA on, the session
 * is pending and the response only says a code is needed; no user data is sent before the code.
 */
async function startSession<User extends { id: string; avatarUrl: string | null }>(
  req: Request,
  res: Response,
  user: User,
): Promise<void> {
  const twoFactorRequired = await createSession(req, res, user.id);
  res.json(twoFactorRequired ? { twoFactorRequired } : { user: toPublicUser(user) });
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
  // Google-only accounts have no password, so they fail like unknown emails.
  if (!user?.passwordHash) {
    await verifyPassword(password, await dummyPasswordHash);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { id, email: userEmail, displayName, avatarUrl } = user;
  await startSession(req, res, { id, email: userEmail, displayName, avatarUrl });
});

const googleProvider = "google";

/**
 * Signs in with a Google authorization code. An email with no account gets a new account.
 * An existing account is linked only when its email is verified; otherwise 409, because
 * whoever registered the unverified address would keep password access to that account.
 */
authRouter.post("/google", async (req, res, next) => {
  const { code, codeVerifier, redirectUri } = req.body ?? {};
  if (typeof code !== "string" || typeof codeVerifier !== "string" || typeof redirectUri !== "string") {
    res.status(400).json({ error: "code, codeVerifier and redirectUri must be strings" });
    return;
  }

  try {
    const google = await exchangeGoogleCode(code, codeVerifier, redirectUri);
    if (!google) {
      res.status(401).json({ error: "Google sign-in failed" });
      return;
    }

    const linkedUser = await findUserByIdentity(googleProvider, google.sub);
    if (linkedUser) {
      await startSession(req, res, linkedUser);
      return;
    }

    const existingUser = await findUserByEmail(google.email);
    if (existingUser) {
      // linkIdentity is false when the account is already linked to a different Google account.
      if (!existingUser.emailVerifiedAt || !(await linkIdentity(existingUser.id, googleProvider, google.sub))) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      const { id, email, displayName, avatarUrl } = existingUser;
      await startSession(req, res, { id, email, displayName, avatarUrl });
      return;
    }

    const displayName =
      parseRequiredText(google.name, TEXT_LIMITS.displayName) ?? google.email.slice(0, TEXT_LIMITS.displayName);
    const user = await createUserWithIdentity(google.email, displayName, googleProvider, google.sub);
    await createSession(req, res, user.id);
    res.status(201).json({ user: { ...user, avatarUrl: null } });
  } catch (error) {
    next(error);
  }
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
    if (!previousHash) {
      res.status(400).json({ error: "This account has no password" });
      return;
    }
    if (!(await verifyPassword(currentPassword, previousHash))) {
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

const invalidCodeError = { error: "Invalid code" };

/** Reads a string body field and returns it, or undefined when it is missing or not a string. */
function bodyString(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Checks a TOTP code for a user with 2FA on and claims its step so it cannot be used again.
 * Returns false for a wrong, expired or already used code.
 */
async function consumeTotpCode(
  userId: string,
  state: NonNullable<Awaited<ReturnType<typeof findTotpState>>>,
  code: string,
): Promise<boolean> {
  if (!state.totpSecretEncrypted) return false;
  const step = verifyTotp(decryptSecret(state.totpSecretEncrypted), code, state.totpLastUsedStep);
  return step !== undefined && (await claimTotpStep(userId, step));
}

/** Creates a TOTP secret and returns it with the `otpauth://` URI. 2FA stays off until `enable`. */
authRouter.post("/2fa/setup", requireAuthenticatedUser, async (_req, res, next) => {
  if (!isTwoFactorConfigured()) {
    res.status(404).json({ error: "Two-factor authentication is not available" });
    return;
  }

  try {
    const userId = res.locals.userId as string;
    const state = await findTotpState(userId);
    if (!state) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const secret = generateSecret();
    if (!(await saveTotpSecret(userId, encryptSecret(secret)))) {
      res.status(409).json({ error: "Two-factor authentication is already enabled" });
      return;
    }
    res.json({ secret, otpauthUri: otpauthUri(secret, state.email) });
  } catch (error) {
    next(error);
  }
});

/** Verifies the first code, turns 2FA on and returns the recovery codes, which are never shown again. */
authRouter.post("/2fa/enable", requireAuthenticatedUser, async (req, res, next) => {
  const code = bodyString(req.body, "code");
  if (code === undefined) {
    res.status(400).json({ error: "code must be a string" });
    return;
  }

  try {
    const state = await findTotpState(res.locals.userId as string);
    if (!state?.totpSecretEncrypted || state.totpEnabledAt) {
      res.status(409).json({ error: "Call setup first, or two-factor authentication is already enabled" });
      return;
    }
    const step = verifyTotp(decryptSecret(state.totpSecretEncrypted), code, null);
    if (step === undefined) {
      res.status(401).json(invalidCodeError);
      return;
    }
    const recoveryCodes = generateRecoveryCodes();
    if (!(await activateTotp(res.locals.userId as string, step, recoveryCodes.map(hashRecoveryCode)))) {
      res.status(409).json({ error: "Two-factor authentication is already enabled" });
      return;
    }
    res.json({ recoveryCodes });
  } catch (error) {
    next(error);
  }
});

/** Completes a pending session with a TOTP code (current step plus or minus one, each step once). */
authRouter.post("/2fa/verify", requirePendingSession, async (req, res, next) => {
  const code = bodyString(req.body, "code");
  if (code === undefined) {
    res.status(400).json({ error: "code must be a string" });
    return;
  }

  try {
    const userId = res.locals.userId as string;
    const state = await findTotpState(userId);
    if (!state || !(await consumeTotpCode(userId, state, code))) {
      res.status(401).json(invalidCodeError);
      return;
    }
    await completePendingSession(req, res, res.locals.sessionId as string);
    const user = await findUserById(userId);
    res.json({ user: user && toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

/** Completes a pending session with a recovery code and burns it. */
authRouter.post("/2fa/recover", requirePendingSession, async (req, res, next) => {
  const recoveryCode = bodyString(req.body, "recoveryCode");
  if (recoveryCode === undefined) {
    res.status(400).json({ error: "recoveryCode must be a string" });
    return;
  }

  try {
    const userId = res.locals.userId as string;
    if (!(await burnRecoveryCode(userId, hashRecoveryCode(recoveryCode)))) {
      res.status(401).json({ error: "Invalid recovery code" });
      return;
    }
    await completePendingSession(req, res, res.locals.sessionId as string);
    const user = await findUserById(userId);
    res.json({ user: user && toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

/**
 * Turns 2FA off after re-authentication: the password too when the account has one, plus a TOTP
 * code or a recovery code. Revokes every other session. One generic 401 hides which check failed.
 */
authRouter.post("/2fa/disable", requireAuthenticatedUser, async (req, res, next) => {
  const password = bodyString(req.body, "password");
  const code = bodyString(req.body, "code");
  const recoveryCode = bodyString(req.body, "recoveryCode");
  if (code === undefined && recoveryCode === undefined) {
    res.status(400).json({ error: "code or recoveryCode is required" });
    return;
  }

  try {
    const userId = res.locals.userId as string;
    const state = await findTotpState(userId);
    if (!state?.totpEnabledAt) {
      res.status(409).json({ error: "Two-factor authentication is not enabled" });
      return;
    }
    if (state.passwordHash && (password === undefined || !(await verifyPassword(password, state.passwordHash)))) {
      res.status(401).json({ error: "Invalid password or code" });
      return;
    }
    const isSecondFactorValid =
      code !== undefined
        ? await consumeTotpCode(userId, state, code)
        : await burnRecoveryCode(userId, hashRecoveryCode(recoveryCode ?? ""));
    if (!isSecondFactorValid) {
      res.status(401).json({ error: "Invalid password or code" });
      return;
    }
    await deactivateTotp(userId, res.locals.sessionId as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
