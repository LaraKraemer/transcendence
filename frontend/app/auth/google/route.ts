import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { persistSessionFromSetCookie, secureCookies } from "@/lib/session";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ROUTE_PATH = "/auth/google";
// Holds "<state>.<PKCE verifier>" between leaving for Google and coming back.
const OAUTH_COOKIE = "google_oauth";
const oauthCookieMaxAgeSeconds = 10 * 60;
const backendRequestTimeoutMs = 15_000;

/**
 * Google sign-in. This URL is also the OAuth redirect URI, so it runs twice:
 * without `code` it sends the browser to Google with a new state and PKCE challenge;
 * when Google sends the browser back, it checks the state, lets the backend sign in
 * (POST /auth/google), and copies the session cookie like the sign-in action does.
 * A 409 means the email belongs to an account that can't be linked yet.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // request.nextUrl.origin carries Next's internal port when served behind the HTTPS proxy.
  const redirectUri = `${request.headers.get("x-forwarded-proto")}://${request.headers.get("host")}${ROUTE_PATH}`;
  const cookieStore = await cookies();
  const code = params.get("code");
  const googleError = params.get("error");

  if (!code && !googleError) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) redirect("/login?error=googleFailed");
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    cookieStore.set(OAUTH_COOKIE, `${state}.${codeVerifier}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: ROUTE_PATH,
      maxAge: oauthCookieMaxAgeSeconds,
    });
    const googleUrl = new URL(GOOGLE_AUTH_URL);
    googleUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    redirect(googleUrl.toString());
  }

  const [state, codeVerifier] = cookieStore.get(OAUTH_COOKIE)?.value.split(".") ?? [];
  cookieStore.delete({ name: OAUTH_COOKIE, path: ROUTE_PATH });
  // The user closed Google's consent screen: back to the form, no error.
  if (googleError === "access_denied") redirect("/login");
  if (!code || !state || !codeVerifier || params.get("state") !== state) redirect("/login?error=googleFailed");

  let response: Response;
  try {
    response = await fetch(`${process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ""}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
      signal: AbortSignal.timeout(backendRequestTimeoutMs),
    });
  } catch (error) {
    console.error("Google sign-in: backend request failed:", error);
    redirect("/login?error=googleFailed");
  }
  if (response.status === 409) redirect("/login?error=googleEmailTaken");
  if (!response.ok) redirect("/login?error=googleFailed");

  await persistSessionFromSetCookie(response.headers.getSetCookie());
  // An account with two-factor authentication gets a pending session and still has to enter a code.
  const body = await response.json().catch(() => ({}));
  redirect(body?.twoFactorRequired ? "/login?step=2fa" : "/dashboard");
}
