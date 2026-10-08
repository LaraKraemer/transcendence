"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { ActionResponse } from "@/lib/types";
import { MIN_PASSWORD_LENGTH, isValidationErrorCode, type ValidationErrorCode } from "@/lib/validation";

export type FormErrorCode = "emailTaken" | "invalidCredentials" | "network" | "generic";

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
 * Google sign-in isn't built yet (ask the team about it),
 * so the button is shown but can't be clicked.
 */
export function SocialSignIn({ dividerLabel }: { dividerLabel: string }) {
  const t = useTranslations();
  return (
    <>
      <Button variant="outline" disabled title={t("common.comingSoon")}>
        <span aria-hidden className="font-bold text-[#4285F4]">
          G
        </span>
        {t("auth.continueWithGoogle")}
      </Button>
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
    <button
      type="button"
      onClick={onToggle}
      aria-label={t("auth.showPassword")}
      aria-pressed={visible}
      className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
    >
      <Icon size={17} aria-hidden />
    </button>
  );
}

/** Red box at the top of the form, e.g. for a wrong password or when the server is down. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-[18px] rounded-[11px] bg-danger-bg px-[15px] py-3 text-[13px] font-medium text-destructive">
      {message}
    </div>
  );
}
