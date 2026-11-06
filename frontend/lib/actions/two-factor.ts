"use server";

/**
 * Two-factor authentication server actions for the profile: start the setup
 * (`POST /auth/2fa/setup`), turn it on with a first code (`/enable`) and turn it
 * off again (`/disable`). Enabling and disabling refresh the route, so the profile
 * re-renders with the new `twoFactorEnabled`. The sign-in code step is in lib/actions/auth.ts.
 */
import { refresh } from "next/cache";

import { backendFailure } from "@/lib/action-errors";
import { fetchApiServer } from "@/lib/dal";
import type { ActionResponse } from "@/lib/types";

export type TwoFactorSetup = { secret: string; otpauthUri: string };

/** Creates a new, not yet active secret. 404 means the server has no encryption key; 409 that 2FA is already on. */
export async function startTwoFactorSetup(): Promise<ActionResponse & { setup?: TwoFactorSetup }> {
  try {
    const setup = await fetchApiServer<TwoFactorSetup>("/auth/2fa/setup", { method: "POST" });
    return { success: true, message: "Setup started", setup };
  } catch (error) {
    return backendFailure(error, "startTwoFactorSetup");
  }
}

/** Confirms the first code from the authenticator app. The recovery codes in the answer are shown only once. */
export async function enableTwoFactor(code: string): Promise<ActionResponse & { recoveryCodes?: string[] }> {
  let recoveryCodes: string[];
  try {
    ({ recoveryCodes } = await fetchApiServer<{ recoveryCodes: string[] }>("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code: String(code) }),
    }));
  } catch (error) {
    return backendFailure(error, "enableTwoFactor");
  }

  refresh();
  return { success: true, message: "Two-factor authentication enabled", recoveryCodes };
}

/** Turns 2FA off. Needs the password (users who have one) and an authenticator code or a recovery code. */
export async function disableTwoFactor(input: {
  password?: string;
  code?: string;
  recoveryCode?: string;
}): Promise<ActionResponse> {
  const { password, code, recoveryCode } = input;
  try {
    await fetchApiServer("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({
        ...(password === undefined ? {} : { password: String(password) }),
        ...(code === undefined ? {} : { code: String(code) }),
        ...(recoveryCode === undefined ? {} : { recoveryCode: String(recoveryCode) }),
      }),
    });
  } catch (error) {
    return backendFailure(error, "disableTwoFactor");
  }

  refresh();
  return { success: true, message: "Two-factor authentication disabled" };
}
