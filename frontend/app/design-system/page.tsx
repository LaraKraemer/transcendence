import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DesignSystemShowcase } from "@/app/design-system/showcase";
import { PublicPageShell } from "@/components/legal/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem");
  return { title: t("title") };
}

/** The palette, type scale, icons and reusable components, open to everyone like the legal pages. */
export default async function DesignSystemPage({ searchParams }: PageProps<"/design-system">) {
  const { from } = await searchParams;
  return (
    <PublicPageShell from={from}>
      <DesignSystemShowcase />
    </PublicPageShell>
  );
}
