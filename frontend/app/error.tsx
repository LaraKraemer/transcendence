"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect } from "react";

import { STATUS_HEADING_ID, StatusPage } from "@/components/status-page";
import { Button, buttonClassName } from "@/components/ui/button";

export type ErrorPageProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * The error page for login, register and the protected layout itself (an error.tsx
 * doesn't cover the layout in its own folder). (protected)/error.tsx shows the same
 * page inside the app shell. Shows the digest, which matches the server log, as a
 * reference code, never `error.message`: it can contain internal details.
 */
export default function ErrorPage({ error, retry, inAppShell = false }: ErrorPageProps & { inAppShell?: boolean }) {
  const t = useTranslations();
  // The content is replaced without a navigation, so move focus to tell screen reader users.
  useEffect(() => document.getElementById(STATUS_HEADING_ID)?.focus(), []);

  return (
    <StatusPage
      icon={TriangleAlert}
      title={t("status.error.title")}
      description={t("status.error.description")}
      reference={error.digest && t("status.error.reference", { code: error.digest })}
      standalone={!inAppShell}
    >
      <title>{`${t("status.error.title")} · ${t("metadata.appTitle")}`}</title>
      {/* retry() fetches the data again, so a temporary backend problem can recover without a reload. */}
      <Button onClick={() => retry()}>{t("status.error.retry")}</Button>
      <Link href="/accounts" className={buttonClassName("outline")}>
        {t("status.toAccounts")}
      </Link>
    </StatusPage>
  );
}
