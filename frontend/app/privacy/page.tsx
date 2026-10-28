import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage } from "@/components/legal/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return { title: t("title") };
}

export default async function PrivacyPage({ searchParams }: PageProps<"/privacy">) {
  const { from } = await searchParams;
  return <LegalPage kind="privacy" from={from} />;
}
