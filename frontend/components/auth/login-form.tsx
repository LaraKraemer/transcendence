"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import {
  FormAlert,
  PasswordVisibilityButton,
  SocialSignIn,
  formErrorFor,
  serverFieldErrors,
  useAuthErrorText,
  type FormErrorCode,
} from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth-context";
import { validateLogin, type FieldErrors, type LoginFields } from "@/lib/validation";

// Errors are stored as codes, so they re-translate if the language changes.
type LoginState = { fieldErrors: FieldErrors<keyof LoginFields>; error: FormErrorCode | null };

const initialState: LoginState = { fieldErrors: {}, error: null };

export function LoginForm() {
  const t = useTranslations();
  const errorText = useAuthErrorText();
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [{ fieldErrors, error }, formAction, isPending] = useActionState(
    async (_prev: LoginState, formData: FormData): Promise<LoginState> => {
      const values = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      };
      const errors = validateLogin(values);
      if (Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };

      try {
        const result = await login(values);
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
    initialState,
  );

  return (
    <>
      <h1 className="mb-1.5 text-[28px] font-bold tracking-[-0.02em]">{t("auth.signIn.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("auth.signIn.subtitle")}</p>

      <SocialSignIn dividerLabel={t("auth.signIn.divider")} />

      <form action={formAction} noValidate>
        <fieldset disabled={isPending}>
          <FormAlert message={error && errorText(error)} />
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
