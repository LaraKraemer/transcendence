import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SignInHero } from "@/components/auth/auth-hero";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("signInTitle") };
}

export default function LoginPage() {
  return (
    <AuthShell hero={<SignInHero />}>
      <LoginForm />
    </AuthShell>
  );
}
