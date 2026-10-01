/**
 * Server-side data access layer.
 *
 * `getCurrentUser` is the single source of truth for "who is logged in" on the
 * server. It runs in Server Components (root/route-group layouts) and reads the
 * session straight from the request cookie, so it never crosses the network
 * boundary from the client. The `server-only` import makes bundling this into
 * client code a build error.
 */
import "server-only";

import { ApiError, fetchApi } from "@/lib/api";
import { getSessionCookieHeader } from "@/lib/session";
import type { User } from "@/lib/types";

/**
 * Returns the authenticated user for the current request, or `null` when there
 * is no active session.
 *
 * Forwards the inbound session cookie to the backend `GET /auth/me`. A `401`
 * means "not logged in" and maps to `null`; any other failure is logged and
 * also treated as `null` so a transient backend error degrades to logged-out
 * rather than crashing the render.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookie = await getSessionCookieHeader();
  if (!cookie) return null;

  try {
    const { user } = await fetchApi<{ user: User }>("/auth/me", {
      headers: { cookie },
    });
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    console.error("getCurrentUser failed:", error);
    return null;
  }
}
