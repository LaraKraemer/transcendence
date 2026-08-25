import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "./db/client.ts";
import { appUsers, sessions } from "./db/schema.ts";

const SESSION_COOKIE = "session";
const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;
const isProduction = process.env.NODE_ENV === "production";

/** Returns a non-reversible SHA-256 value for storing a session token safely. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Reads the raw session token from the request cookie, when one is present. */
function readSessionToken(req: Request): string | undefined {
  const token = req.cookies?.[SESSION_COOKIE];
  return typeof token === "string" ? token : undefined;
}

/**
 * Creates a persisted session for a user and sends its raw token in an
 * HTTP-only cookie. Only the token hash is saved to PostgreSQL.
 */
export async function createSession(req: Request, res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
    expiresAt,
  });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    expires: expiresAt,
    path: "/",
  });
}

/** Removes the session cookie from the client after logout. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
  });
}

/**
 * Validates the request's session token and returns its user ID when the
 * session is active, unexpired, and belongs to a non-deleted user.
 */
export async function getAuthenticatedUserId(req: Request): Promise<string | undefined> {
  const token = readSessionToken(req);
  if (!token) return undefined;

  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(appUsers, eq(sessions.userId, appUsers.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        isNull(appUsers.deletedAt),
      ),
    )
    .limit(1);

  return session?.userId;
}

/**
 * Express middleware that rejects unauthenticated requests and makes the
 * authenticated user's ID available as `res.locals.userId` to later handlers.
 */
export async function requireAuthenticatedUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.locals.userId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

/** Creates a bcrypt password hash suitable for persistent storage. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/** Compares a supplied password with its stored bcrypt hash. */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/** Marks the request's current session as revoked so its token cannot be reused. */
export async function revokeCurrentSession(req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (!token) return;

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}
