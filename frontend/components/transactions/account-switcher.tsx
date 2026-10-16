"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId } from "react";

import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";

const lastAccountMaxAgeSeconds = 60 * 60 * 24 * 365;

export function AccountSwitcher({
  accounts,
  currentAccountId,
  query,
}: {
  accounts: { id: string; name: string }[];
  currentAccountId?: string;
  query: string;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const selectId = useId();

  useEffect(() => {
    if (currentAccountId) {
      document.cookie = `${LAST_ACCOUNT_COOKIE}=${currentAccountId}; path=/; max-age=${lastAccountMaxAgeSeconds}; samesite=lax`;
    }
  }, [currentAccountId]);

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <label htmlFor={selectId} className="shrink-0 text-xs font-medium text-muted-foreground sm:text-[13px]">
        {t("accountSwitcher")}
      </label>
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <select
          id={selectId}
          value={currentAccountId ?? ""}
          onChange={(event) => router.push(`/accounts/${event.target.value}/transactions${query}`, { scroll: false })}
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
    </div>
  );
}
