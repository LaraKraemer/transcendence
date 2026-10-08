import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SignUpHero } from "@/components/auth/auth-hero";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("signUpTitle") };
}

export default function RegisterPage() {
  return (
    <AuthShell hero={<SignUpHero />}>
      <RegisterForm />
    </AuthShell>
  );
}
