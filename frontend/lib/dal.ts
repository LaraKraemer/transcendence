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

import { cache } from "react";

import { ApiError, fetchApi } from "@/lib/api";
import { getSessionCookieHeader } from "@/lib/session";
import type { User } from "@/lib/types";

/**
 * Server-side `fetchApi` that forwards the inbound session cookie to the
 * backend. Needed because `credentials: "include"` is a browser-only concept:
 * a fetch made from a Server Component or server action carries no cookies
 * unless they are set on the request explicitly.
 */
export async function fetchApiServer<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = await getSessionCookieHeader();
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetchApi<T>(path, { ...init, headers });
}

/**
 * Returns the authenticated user for the current request, or `null` when there
 * is no active session.
 *
 * Forwards the inbound session cookie to the backend `GET /auth/me`. A `401`
 * means "not logged in" and maps to `null`; any other failure is logged and
 * also treated as `null` so a transient backend error degrades to logged-out
 * rather than crashing the render.
 *
 * Wrapped in React `cache()` so the root layout and the route-group layouts
 * share one `/auth/me` call per request instead of each making their own.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  // Skip the backend round-trip entirely for visitors with no session cookie.
  if (!(await getSessionCookieHeader())) return null;

  try {
    const { user } = await fetchApiServer<{ user: User }>("/auth/me");
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    console.error("getCurrentUser failed:", error);
    return null;
  }
});
