import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";

import { db } from "./db/client.ts";
import { appUsers, sessions } from "./db/schema.ts";

const SESSION_COOKIE = "session";
const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;
// Retain expired or revoked sessions for seven days.
const STALE_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_COST_FACTOR = 12;
const isProduction = process.env.NODE_ENV === "production";
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
 * session is active, unexpired, and belongs to an existing user.
 */
export async function getAuthenticatedUserId(req: Request): Promise<string | undefined> {
  const token = readSessionToken(req);
  if (!token) return undefined;

  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(appUsers, eq(sessions.userId, appUsers.id))
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt)),
    )
    .limit(1);

  return session?.userId;
}

/**
 * Express middleware that rejects unauthenticated requests and makes the
 * authenticated user's ID available as `res.locals.userId` to later handlers.
 */
export async function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.locals.userId = userId;
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
