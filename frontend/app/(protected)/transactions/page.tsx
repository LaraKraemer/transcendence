import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountSwitcher } from "@/components/transactions/account-switcher";
import { fetchApiServer } from "@/lib/dal";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import type { Account } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("transactions") };
}

export default async function TransactionsPage() {
  const [t, accounts, cookieStore] = await Promise.all([
    getTranslations(),
    fetchApiServer<Account[]>("/accounts"),
    cookies(),
  ]);

  const lastAccountId = cookieStore.get(LAST_ACCOUNT_COOKIE)?.value;
  if (accounts.some((account) => account.id === lastAccountId)) redirect(`/accounts/${lastAccountId}/transactions`);

  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      <h1 className="mb-[18px] text-[15px] font-bold tracking-[-0.02em] sm:mb-6 sm:text-[26px]">
        {t("nav.transactions")}
      </h1>

      <div className="mb-3.5 flex flex-col gap-3 sm:mb-5 sm:flex-row-reverse sm:items-center sm:justify-between">
        <AccountSwitcher accounts={accounts} query="" />
        <div
          role="group"
          aria-label={t("transactions.filterLabel")}
          aria-disabled="true"
          className="flex cursor-not-allowed gap-1 rounded-[11px] border border-border bg-muted p-1 opacity-50 sm:inline-flex"
        >
          {(["all", "income", "expense"] as const).map((option) => (
            <span
              key={option}
              className={`flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[13px] sm:flex-none font-medium text-muted-foreground ${option === "all" ? "bg-card shadow-sm" : ""}`}
            >
              {t(`transactions.filters.${option}`)}
            </span>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-6 sm:py-10 sm:text-sm">
        {accounts.length === 0 ? (
          <Link
            href="/accounts"
            className="rounded-sm underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("accounts.empty")}
          </Link>
        ) : (
          <p>{t("transactions.chooseAccountHint")}</p>
        )}
      </section>
    </div>
  );
}
