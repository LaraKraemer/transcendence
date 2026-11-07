"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonClassName } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import type { ActionResponse } from "@/lib/types";
import { MIN_PASSWORD_LENGTH, isValidationErrorCode, type ValidationErrorCode } from "@/lib/validation";

export type GoogleErrorCode = "googleEmailTaken" | "googleFailed";
export type FormErrorCode =
  "emailTaken" | "invalidCredentials" | "currentPasswordInvalid" | "network" | "generic" | GoogleErrorCode;
export type AuthNotice = "passwordChanged" | "profileDeleted";

/** Narrows the `?error=` that app/auth/google/route.ts adds to /login to a known code. */
export function googleErrorFor(param: string | undefined): GoogleErrorCode | null {
  return param === "googleEmailTaken" || param === "googleFailed" ? param : null;
}

/** Narrows the `?notice=` that the profile page adds to /login after ending the session. */
export function authNoticeFor(param: string | undefined): AuthNotice | null {
  return param === "passwordChanged" || param === "profileDeleted" ? param : null;
}

/** Gives back a function that turns an error code into a message in the user's language. */
export function useAuthErrorText() {
  const t = useTranslations("auth.errors");
  return (code: ValidationErrorCode | FormErrorCode) => t(code, { min: MIN_PASSWORD_LENGTH });
}

/**
 * The server can send several errors per field, but the form shows just one.
 * We keep the first error we have a translation for and ignore the rest.
 * If no field has one left, the form shows a general error at the top instead.
 */
export function serverFieldErrors(errors: ActionResponse["errors"]): Partial<Record<string, ValidationErrorCode>> {
  if (!errors) return {};
  return Object.fromEntries(
    Object.entries(errors)
      .map(([field, codes]) => [field, codes?.find(isValidationErrorCode)] as const)
      .filter(([, code]) => code),
  );
}

/**
 * Picks the message for the top of the form when sign-in or sign-up fails.
 * No status means the request never reached the backend, so it's a network
 * problem (see startSession in lib/actions/auth.ts).
 */
export function formErrorFor(result: ActionResponse): FormErrorCode {
  if (result.status === 401) return "invalidCredentials";
  if (result.status === 409) return "emailTaken";
  if (result.status === undefined && !result.errors) return "network";
  return "generic";
}

/**
 * The "Continue with Google" button and the "or" line below it.
 * A plain <a>, not next/link: /auth/google is a route handler that redirects to Google.
 */
export function SocialSignIn({ dividerLabel }: { dividerLabel: string }) {
  const t = useTranslations();
  return (
    <>
      <a href="/auth/google" className={buttonClassName("outline")}>
        <span aria-hidden className="font-bold text-[#4285F4]">
          G
        </span>
        {t("auth.continueWithGoogle")}
      </a>
      <div className="my-[22px] flex items-center gap-3.5 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {dividerLabel}
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

export function PasswordVisibilityButton({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const t = useTranslations();
  const Icon = visible ? EyeOff : Eye;
  return (
    <ToggleButton
      label={t("auth.showPassword")}
      pressed={visible}
      onPressedChange={onToggle}
      variant="plain"
      size="inline"
    >
      <Icon size={17} aria-hidden />
    </ToggleButton>
  );
}
