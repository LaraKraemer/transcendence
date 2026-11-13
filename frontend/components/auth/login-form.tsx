"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  PasswordVisibilityButton,
  SocialSignIn,
  authNoticeFor,
  formErrorFor,
  googleErrorFor,
  serverFieldErrors,
  useAuthErrorText,
  type FormErrorCode,
} from "@/components/auth/form-parts";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth-context";
import { validateLogin, type FieldErrors, type LoginFields } from "@/lib/validation";

// Errors are stored as codes, so they re-translate if the language changes.
type LoginState = { fieldErrors: FieldErrors<keyof LoginFields>; error: FormErrorCode | null };

const initialState: LoginState = { fieldErrors: {}, error: null };

/**
 * `notice` is the `?notice=` the profile page sends after a password change or a profile delete.
 * `twoFactorStep` opens on the code step, which is where Google sign-in lands for an account with 2FA.
 */
export function LoginForm({
  googleError,
  notice,
  twoFactorStep = false,
}: {
  googleError?: string;
  notice?: string;
  twoFactorStep?: boolean;
}) {
  const t = useTranslations();
  const noticeCode = authNoticeFor(notice);
  const errorText = useAuthErrorText();
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"password" | "code">(twoFactorStep ? "code" : "password");
  // Set when the pending session ran out while the user was on the code step.
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const [{ fieldErrors, error }, formAction, isPending] = useActionState(
    async (_prev: LoginState, formData: FormData): Promise<LoginState> => {
      const values = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      };
      setIsSessionExpired(false);
      const errors = validateLogin(values);
      if (Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };

      try {
        const result = await login(values);
        if (result.twoFactorRequired) {
          setStep("code");
          return initialState;
        }
        if (result.success) {
          router.push("/dashboard");
          return initialState;
        }
        const serverErrors = serverFieldErrors(result.errors);
        return Object.keys(serverErrors).length > 0
          ? { fieldErrors: serverErrors, error: null }
          : { fieldErrors: {}, error: formErrorFor(result) };
      } catch {
        return { fieldErrors: {}, error: "generic" };
      }
    },
    { ...initialState, error: googleErrorFor(googleError) },
  );

  useEffect(() => {
    if (!isPending) {
      const firstInvalid = ["email", "password"].find((field) => fieldErrors[field as keyof LoginFields]);
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
    }
  }, [fieldErrors, isPending]);

  if (step === "code") {
    return (
      <TwoFactorForm
        onExpired={() => {
          setIsSessionExpired(true);
          setStep("password");
        }}
        onBack={() => setStep("password")}
      />
    );
  }

  return (
    <>
      <h1 className="mb-1.5 text-[28px] font-bold tracking-[-0.02em]">{t("auth.signIn.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("auth.signIn.subtitle")}</p>

      <FormAlert tone="success" message={noticeCode && t(`auth.notices.${noticeCode}`)} />
      <SocialSignIn dividerLabel={t("auth.signIn.divider")} />

      <form action={formAction} noValidate>
        <fieldset disabled={isPending}>
          <FormAlert message={error ? errorText(error) : isSessionExpired ? errorText("sessionExpired") : null} />
          <TextField
            id="email"
            name="email"
            label={t("auth.fields.email")}
            type="email"
            dir="ltr"
            autoComplete="email"
            placeholder={t("auth.fields.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email && errorText(fieldErrors.email)}
          />
          <TextField
            id="password"
            name="password"
            label={t("auth.fields.password")}
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password && errorText(fieldErrors.password)}
            trailing={
              <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} />
            }
          />
          <Button type="submit" variant="primary">
            {isPending ? t("auth.signIn.submitting") : t("auth.signIn.submit")}
          </Button>
        </fieldset>
      </form>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        {t("auth.signIn.noAccount")}{" "}
        <Link href="/register" className="font-semibold text-primary hover:opacity-80 dark:text-accent-foreground">
          {t("auth.signIn.createAccount")}
        </Link>
      </p>
    </>
  );
}
