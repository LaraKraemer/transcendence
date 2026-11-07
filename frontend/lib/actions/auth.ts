"use server";

/**
 * Authentication server actions.
 *
 * These `"use server"` functions are the only place the session cookie is
 * written or cleared. They validate input with Zod, call the Express backend,
 * and bridge the session cookie across the BFF hop (see lib/session.ts):
 * `signIn`/`signUp` mirror the backend's `Set-Cookie` onto the browser;
 * `signOut` forwards the cookie to the backend and then clears it locally.
 */
import { z } from "zod";

import { clearSession, getSessionCookieHeader, persistSessionFromSetCookie } from "@/lib/session";
import type { ActionResponse, User } from "@/lib/types";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  passwordByteLength,
  type ValidationErrorCode,
} from "@/lib/validation";

// Error messages are the ValidationErrorCodes from lib/validation.ts, not
// sentences, so the forms can translate server-side field errors exactly like
// their own client-side ones.

// Login only needs a non-empty password: the backend's login route checks that
// the password is a string, not its length. Enforcing a length here would lock
// out any account whose password predates (or differs from) the sign-up rule.
const SignInSchema = z.object({
  email: z.email({ error: "emailInvalid" satisfies ValidationErrorCode }),
  password: z.string().min(1, { error: "passwordRequired" satisfies ValidationErrorCode }),
});

// Mirror the backend's register rule exactly (routes/auth.ts): at least 12
// characters, and at most 72 *bytes*. The byte cap must be measured in UTF-8 —
// a plain .max(72) counts characters, so multi-byte input (ä, emoji) would slip
// past Zod and only fail at the backend with a generic message.
const SignUpSchema = z.object({
  email: z.email({ error: "emailInvalid" satisfies ValidationErrorCode }),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, { error: "passwordTooShort" satisfies ValidationErrorCode })
    .refine((p) => passwordByteLength(p) <= MAX_PASSWORD_BYTES, {
      error: "passwordTooLong" satisfies ValidationErrorCode,
    }),
  displayName: z
    .string()
    .trim()
    .min(1, { error: "displayNameRequired" satisfies ValidationErrorCode })
    .max(MAX_DISPLAY_NAME_LENGTH, { error: "displayNameTooLong" satisfies ValidationErrorCode }),
});

export type SignInInput = z.infer<typeof SignInSchema>;
export type SignUpInput = z.infer<typeof SignUpSchema>;

function backendBaseUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";
}

/**
 * Posts credentials to a backend auth endpoint that starts a session, mirrors
 * the returned `Set-Cookie` onto the browser, and returns the authenticated user.
 * For an account with two-factor authentication the backend answers
 * `{ twoFactorRequired: true }` with a pending session cookie instead of a user.
 * `forwardCookie` sends the current (pending) session cookie, which the code
 * endpoints need. A network failure (backend unreachable) is returned as a failed
 * response so the form can show a message instead of hitting an unhandled error.
 */
async function startSession(
  path: string,
  payload: unknown,
  successMessage: string,
  forwardCookie = false,
): Promise<ActionResponse> {
  const cookie = forwardCookie ? await getSessionCookieHeader() : undefined;
  let res: Response;
  try {
    res = await fetch(`${backendBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(`startSession: request to ${path} failed:`, error);
    return { success: false, message: "Could not reach the server. Please try again later." };
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { success: false, message: body?.error ?? res.statusText, status: res.status };
  }

  await persistSessionFromSetCookie(res.headers.getSetCookie());
  if (body.twoFactorRequired) return { success: true, message: "Two-factor code required", twoFactorRequired: true };
  return { success: true, message: successMessage, user: body.user as User };
}

/** Validates credentials, logs the user in, and starts a session. */
export async function signIn(data: SignInInput): Promise<ActionResponse> {
  const parsed = SignInSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  return startSession("/auth/login", parsed.data, "Signed in successfully");
}

/** Validates input, registers a new user, and starts a session. */
export async function signUp(data: SignUpInput): Promise<ActionResponse> {
  const parsed = SignUpSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  return startSession("/auth/register", parsed.data, "Account created successfully");
}

/** Completes a pending sign-in with the authenticator app's 6-digit code. */
export async function verifyTwoFactor(code: string): Promise<ActionResponse> {
  return startSession("/auth/2fa/verify", { code: String(code) }, "Signed in successfully", true);
}

/** Completes a pending sign-in with a one-time recovery code. */
export async function recoverTwoFactor(recoveryCode: string): Promise<ActionResponse> {
  return startSession("/auth/2fa/recover", { recoveryCode: String(recoveryCode) }, "Signed in successfully", true);
}

/** Revokes the backend session (best-effort) and clears the local session cookie. */
export async function signOut(): Promise<ActionResponse> {
  const cookie = await getSessionCookieHeader();

  try {
    await fetch(`${backendBaseUrl()}/auth/logout`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    });
  } catch (error) {
    // Clear the local cookie regardless so the user ends up logged out.
    console.error("signOut: backend logout failed:", error);
  }

  await clearSession();
  return { success: true, message: "Signed out" };
}
