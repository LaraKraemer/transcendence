import { cookies } from "next/headers";

export const SESSION_COOKIE = "session";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Returns the inbound session cookie as a `Cookie`-header value
 * (`"session=<token>"`) for forwarding to the backend, or `undefined` when no
 * session cookie is present.
 */
export async function getSessionCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  return value ? `${SESSION_COOKIE}=${value}` : undefined;
}

/**
 * Mirrors the backend's `Set-Cookie` headers onto the browser, scoped to the
 * Next.js origin. Parses the `session=<token>` entry and re-sets it as an
 * HTTP-only cookie so the raw token never reaches client JavaScript.
 *
 * @param setCookieHeaders the array from `response.headers.getSetCookie()`.
 */
export async function persistSessionFromSetCookie(setCookieHeaders: string[]): Promise<void> {
  const sessionHeader = setCookieHeaders.find((header) => header.startsWith(`${SESSION_COOKIE}=`));
  if (!sessionHeader) return;

  // "session=<token>; Path=/; HttpOnly; ..." -> "<token>"
  const token = sessionHeader.slice(SESSION_COOKIE.length + 1).split(";")[0];
  if (!token) return;

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Clears the session cookie from the browser (used on logout). */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
