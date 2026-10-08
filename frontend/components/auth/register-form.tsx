"use client";

import { Sparkles } from "lucide-react";
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
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth-context";
import {
  MAX_DISPLAY_NAME_LENGTH,
  validateRegister,
  type RegisterFields,
  type ValidationErrorCode,
} from "@/lib/validation";

// Besides validation codes, the email field can show the server's "email taken" (409).
type RegisterFieldErrors = Partial<Record<keyof RegisterFields, ValidationErrorCode | "emailTaken">>;

// Errors are stored as codes, so they re-translate if the language changes.
type RegisterState = { fieldErrors: RegisterFieldErrors; error: FormErrorCode | null };

const initialState: RegisterState = { fieldErrors: {}, error: null };

export function RegisterForm() {
  const t = useTranslations();
  const errorText = useAuthErrorText();
  const { register } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [{ fieldErrors, error }, formAction, isPending] = useActionState(
    async (_prev: RegisterState, formData: FormData): Promise<RegisterState> => {
      const values = {
        displayName: String(formData.get("displayName") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      };
      const errors = validateRegister(values);
      if (Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };

      try {
        const result = await register(values);
        if (result.success) {
          router.push("/dashboard");
          return initialState;
        }
        if (result.status === 409) return { fieldErrors: { email: "emailTaken" }, error: null };
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
      <span className="mb-3.5 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-[11px] py-[5px] text-xs font-semibold text-success">
        <Sparkles size={13} aria-hidden />
        {t("auth.signUp.badge")}
      </span>
      <h1 className="mb-1.5 text-[28px] font-bold tracking-[-0.02em]">{t("auth.signUp.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("auth.signUp.subtitle")}</p>

      <SocialSignIn dividerLabel={t("auth.signUp.divider")} />

      <form action={formAction} noValidate>
        <fieldset disabled={isPending}>
          <FormAlert message={error && errorText(error)} />
          <TextField
            id="displayName"
            name="displayName"
            label={t("auth.fields.displayName")}
            type="text"
            autoComplete="name"
            placeholder={t("auth.fields.displayNamePlaceholder")}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={fieldErrors.displayName && errorText(fieldErrors.displayName)}
          />
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password && errorText(fieldErrors.password)}
            trailing={
              <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} />
            }
          >
            <PasswordStrength password={password} />
          </TextField>
          <Button type="submit" variant="success">
            {isPending ? t("auth.signUp.submitting") : t("auth.signUp.submit")}
          </Button>
        </fieldset>
      </form>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        {t("auth.signUp.haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-primary hover:opacity-80 dark:text-accent-foreground">
          {t("auth.signUp.logIn")}
        </Link>
      </p>
    </>
  );
}
