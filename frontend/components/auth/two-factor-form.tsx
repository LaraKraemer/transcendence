"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";

import { codeInputProps, twoFactorErrorFor, useAuthErrorText, type FormErrorCode } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { TextField } from "@/components/ui/text-field";
import { signOut } from "@/lib/actions/auth";
import { useAuth } from "@/lib/auth-context";
import { isTwoFactorCode } from "@/lib/validation";

type CodeKind = "code" | "recovery";

/**
 * The second sign-in step for an account with two-factor authentication: the 6-digit code from the
 * authenticator app, or a one-time recovery code. A wrong code stays here with an error; an expired
 * pending session (10 minutes) goes back to the password step through `onExpired`.
 */
export function TwoFactorForm({ onExpired, onBack }: { onExpired: () => void; onBack: () => void }) {
  const t = useTranslations("auth.twoFactor");
  const errorText = useAuthErrorText();
  const { completeTwoFactor } = useAuth();
  const router = useRouter();

  const [kind, setKind] = useState<CodeKind>("code");
  const [value, setValue] = useState("");
  const [isLeaving, setIsLeaving] = useState(false);

  const [submission, submitAction, isPending] = useActionState(
    async (_previous: { error: FormErrorCode | null }, submitted: string): Promise<{ error: FormErrorCode | null }> => {
      if (!isTwoFactorCode(submitted, kind)) return { error: kind === "code" ? "invalidCode" : "invalidRecoveryCode" };
      try {
        const result = await completeTwoFactor(kind, submitted);
        if (result.success) {
          router.push("/dashboard");
          return { error: null };
        }
        const code = twoFactorErrorFor(result, kind === "code" ? "invalidCode" : "invalidRecoveryCode");
        if (code === "sessionExpired") onExpired();
        return { error: code };
      } catch {
        return { error: "generic" };
      }
    },
    { error: null },
  );
  const error = submission.error;

  // After a rejected code, put keyboard focus back on the field (the fieldset disabled it while sending).
  useEffect(() => {
    if (!isPending && submission.error) document.getElementById("two-factor-code")?.focus();
  }, [submission, isPending]);

  function switchKind() {
    setKind(kind === "code" ? "recovery" : "code");
    setValue("");
  }

  async function backToPassword() {
    setIsLeaving(true);
    // Revokes the pending session; the next password sign-in starts a new one.
    await signOut().catch(() => undefined);
    onBack();
  }

  const isCode = kind === "code";
  const isBusy = isPending || isLeaving;
  // The field error replaces the alert for a rejected code, so the message sits next to the input.
  const isFieldError = error === "invalidCode" || error === "invalidRecoveryCode";

  return (
    <>
      <h1 className="mb-1.5 text-[28px] font-bold tracking-[-0.02em]">{t("title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{isCode ? t("subtitleCode") : t("subtitleRecovery")}</p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => submitAction(value));
        }}
      >
        <fieldset disabled={isBusy}>
          <FormAlert message={error && !isFieldError ? errorText(error) : null} />
          <TextField
            // A new key per kind, so the browser autofill and the input attributes reset together.
            key={kind}
            id="two-factor-code"
            name={isCode ? "code" : "recoveryCode"}
            label={isCode ? t("codeLabel") : t("recoveryLabel")}
            hint={isCode ? t("codeHint") : t("recoveryHint")}
            {...codeInputProps(kind)}
            // Focus the field when the step opens.
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={isFieldError ? errorText(error) : undefined}
          />
          <Button type="submit" variant="primary">
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </fieldset>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={switchKind}
          disabled={isBusy}
          className="cursor-pointer rounded-[6px] font-semibold text-primary hover:opacity-80 focus-ring disabled:opacity-60 dark:text-accent-foreground"
        >
          {isCode ? t("useRecovery") : t("useAuthenticator")}
        </button>
        <button
          type="button"
          onClick={backToPassword}
          disabled={isBusy}
          className="cursor-pointer rounded-[6px] text-muted-foreground hover:opacity-80 focus-ring disabled:opacity-60"
        >
          {t("back")}
        </button>
      </div>
    </>
  );
}
