import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { StatusPage } from "@/components/status-page";
import { buttonClassName } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("status.notFound");
  return { title: t("title") };
}

/**
 * The 404 page: URLs that match no route, and `notFound()` outside the app shell.
 * (protected)/not-found.tsx shows the same page inside the app shell.
 */
export default function NotFound({ inAppShell = false }: { inAppShell?: boolean }) {
  const t = useTranslations();
  return (
    <StatusPage
      icon={SearchX}
      title={t("status.notFound.title")}
      description={t("status.notFound.description")}
      standalone={!inAppShell}
    >
      <Link href="/accounts" className={buttonClassName("primary")}>
        {t("status.toAccounts")}
      </Link>
    </StatusPage>
  );
}
