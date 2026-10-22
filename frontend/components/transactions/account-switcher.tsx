"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, type SubmitEvent } from "react";

import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";

const lastAccountMaxAgeSeconds = 60 * 60 * 24 * 365;

export function AccountSwitcher({
  accounts,
  currentAccountId,
  query,
  page = "transactions",
}: {
  accounts: { id: string; name: string }[];
  currentAccountId?: string;
  query: string;
  page?: "transactions" | "dashboard";
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const selectId = useId();

  useEffect(() => {
    if (currentAccountId) {
      document.cookie = `${LAST_ACCOUNT_COOKIE}=${currentAccountId}; path=/; max-age=${lastAccountMaxAgeSeconds}; samesite=lax`;
    }
  }, [currentAccountId]);

  function showAccount(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountId = new FormData(event.currentTarget).get("accountId");
    if (typeof accountId === "string" && accountId !== "" && accountId !== currentAccountId) {
      const href =
        page === "dashboard" ? `/dashboard?accountId=${accountId}` : `/accounts/${accountId}/transactions${query}`;
      router.push(href, { scroll: false });
    }
  }

  return (
    <form onSubmit={showAccount} className="flex w-full items-center gap-2 sm:w-auto">
      <label htmlFor={selectId} className="shrink-0 text-xs font-medium text-muted-foreground sm:text-[13px]">
        {t("accountSwitcher")}
      </label>
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <select
          key={currentAccountId}
          id={selectId}
          name="accountId"
          defaultValue={currentAccountId ?? ""}
          className="w-full cursor-pointer appearance-none truncate rounded-[10px] border border-border bg-card py-[9px] ps-3.5 pe-9 text-xs sm:rounded-[11px] sm:py-2 sm:text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            {t("chooseAccount")}
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      <button
        type="submit"
        className="shrink-0 cursor-pointer rounded-[10px] border border-border bg-card px-3.5 py-[9px] text-xs font-semibold sm:rounded-[11px] sm:py-2 sm:text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t("showAccount")}
      </button>
    </form>
  );
}
