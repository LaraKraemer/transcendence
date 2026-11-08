import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "./db/client.ts";
import { appUsers, sessions } from "./db/schema.ts";

const SESSION_COOKIE = "session";
const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;
// A session that still needs its 2FA code is only worth keeping briefly.
const PENDING_2FA_LIFETIME_MS = 10 * 60 * 1000;
// Retain expired or revoked sessions for seven days.
const STALE_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_COST_FACTOR = 12;
const secureCookies = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const googleRequestTimeoutMs = 10_000;

/** The Google account behind a sign-in. Google has verified `email`; `sub` never changes. */
export type GoogleIdentity = { sub: string; email: string; name: string | undefined };

/** Returns a non-reversible SHA-256 value for storing a session token safely. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Reads the raw session token from the request cookie, when one is present. */
function readSessionToken(req: Request): string | undefined {
  const token = req.cookies?.[SESSION_COOKIE];
  return typeof token === "string" ? token : undefined;
}

/** Sends the raw session token to the browser in the HTTP-only session cookie. */
function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    expires: expiresAt,
    path: "/",
  });
}

/**
 * Creates a persisted session for a user and sends its raw token in an
 * HTTP-only cookie. Only the token hash is saved to PostgreSQL.
 * Returns true when the user has 2FA on: the session is then pending (short-lived and rejected
 * by every protected route) until `completePendingSession`. Every sign-in method ends here, so
 * none can skip the second factor.
 */
export async function createSession(req: Request, res: Response, userId: string): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");

  const { isPending, expiresAt } = await db.transaction(async (tx) => {
    // The share lock makes a concurrent 2FA activation wait, so no verified session can slip in after it.
    const [user] = await tx
      .select({ totpEnabledAt: appUsers.totpEnabledAt })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .for("share");
    const isPending = user?.totpEnabledAt != null;
    const now = Date.now();
    const expiresAt = new Date(now + (isPending ? PENDING_2FA_LIFETIME_MS : SESSION_LIFETIME_MS));

    await tx.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      userAgent: req.get("user-agent"),
      ipAddress: req.ip,
      expiresAt,
      twofaVerifiedAt: isPending ? null : new Date(now),
    });
    return { isPending, expiresAt };
  });

  setSessionCookie(res, token, expiresAt);
  return isPending;
}

/** Turns a pending session into a normal 30-day one after the user proved the second factor. */
export async function completePendingSession(req: Request, res: Response, sessionId: string): Promise<void> {
  const token = readSessionToken(req);
  if (!token) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await db.update(sessions).set({ twofaVerifiedAt: now, expiresAt }).where(eq(sessions.id, sessionId));
  setSessionCookie(res, token, expiresAt);
}

/** Removes the session cookie from the client after logout. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
  });
}

/**
 * Finds the request's active session: unexpired, unrevoked, and for an existing user.
 * A pending session (2FA code not yet entered) is only returned when `isPending` is true,
 * so the normal lookup rejects it everywhere.
 */
async function findSession(req: Request, isPending: boolean) {
  const token = readSessionToken(req);
  if (!token) return undefined;

  const [session] = await db
    .select({ userId: sessions.userId, id: sessions.id })
    .from(sessions)
    .innerJoin(appUsers, eq(sessions.userId, appUsers.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        isPending ? isNull(sessions.twofaVerifiedAt) : isNotNull(sessions.twofaVerifiedAt),
      ),
    )
    .limit(1);

  return session;
}

/**
 * Validates the request's session token and returns its user ID when the session is active,
 * unexpired, fully verified (no pending 2FA code), and belongs to an existing user.
 */
export async function getAuthenticatedUserId(req: Request): Promise<string | undefined> {
  return (await findSession(req, false))?.userId;
}

/**
 * Express middleware that rejects unauthenticated requests and makes the authenticated
 * user's ID and session ID available as `res.locals.userId` / `res.locals.sessionId`.
 */
export async function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await findSession(req, false);
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.locals.userId = session.userId;
  res.locals.sessionId = session.id;
  next();
}

/** Like `requireAuthenticatedUser`, but only for a session that is waiting for its 2FA code. */
export async function requirePendingSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await findSession(req, true);
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.locals.userId = session.userId;
  res.locals.sessionId = session.id;
  next();
}

/** Creates a bcrypt password hash suitable for persistent storage. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/** Compares a supplied password with its stored bcrypt hash. */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Exchanges a Google authorization code and its PKCE verifier for the Google account.
 * Returns undefined when Google rejects the code or has not verified the account's email.
 * The ID token comes straight from Google's token endpoint over TLS, so OpenID Connect Core
 * 3.1.3.7 lets us skip its signature check; issuer, audience and expiry are still checked.
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GoogleIdentity | undefined> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(googleRequestTimeoutMs),
  });
  if (!response.ok) return undefined;

  const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
  if (typeof idToken !== "string") return undefined;
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

  const isValidToken =
    GOOGLE_ISSUERS.includes(String(claims.iss)) &&
    claims.aud === clientId &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > Date.now();
  if (!isValidToken || typeof claims.sub !== "string" || typeof claims.email !== "string") return undefined;
  if (claims.email_verified !== true) return undefined;

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === "string" ? claims.name : undefined,
  };
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

/** Deletes sessions expired or revoked more than seven days ago. */
export async function purgeStaleSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SESSION_RETENTION_MS);
  const result = await db.delete(sessions).where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)));
  return result.rowCount ?? 0;
}
