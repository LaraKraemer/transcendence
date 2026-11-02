import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PublicPageShell } from "@/components/legal/legal-page";
import { SystemStatus } from "@/components/system-status";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("systemStatus");
  return { title: t("title") };
}

/** Public operational status, independent of backend availability. */
export default function StatusPage() {
  return (
    <PublicPageShell from={undefined}>
      <SystemStatus />
    </PublicPageShell>
  );
}
