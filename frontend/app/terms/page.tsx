import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage } from "@/components/legal/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");
  return { title: t("title") };
}

export default async function TermsPage({ searchParams }: PageProps<"/terms">) {
  const { from } = await searchParams;
  return <LegalPage kind="terms" from={from} />;
}
