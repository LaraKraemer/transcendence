"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useOptimistic, useTransition, type ChangeEvent } from "react";

import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";

const lastAccountMaxAgeSeconds = 60 * 60 * 24 * 365;

const ALL_ACCOUNTS = "";

/** Remembers the last used account; "All accounts" deletes the cookie, so /transactions opens all accounts. */
function rememberAccount(accountId: string) {
  const maxAgeSeconds = accountId === ALL_ACCOUNTS ? 0 : lastAccountMaxAgeSeconds;
  document.cookie = `${LAST_ACCOUNT_COOKIE}=${accountId}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

export function AccountSwitcher({
  accounts,
  archivedAccounts = [],
  currentAccountId,
  page = "transactions",
}: {
  accounts: { id: string; name: string }[];
  archivedAccounts?: { id: string; name: string }[];
  currentAccountId?: string;
  page?: "transactions" | "dashboard";
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectId = useId();
  const [, startTransition] = useTransition();
  const [selectedAccountId, setSelectedAccountId] = useOptimistic(currentAccountId ?? ALL_ACCOUNTS);

  // Opening the transactions of an account (from a link too) makes it the last used one.
  useEffect(() => {
    if (page === "transactions") rememberAccount(currentAccountId ?? ALL_ACCOUNTS);
  }, [page, currentAccountId]);

  function showAccount(event: ChangeEvent<HTMLSelectElement>) {
    const accountId = event.target.value;
    // Before navigating: /transactions reads the cookie on the server when it has no accountId.
    rememberAccount(accountId);
    const params = new URLSearchParams(searchParams);
    if (accountId === ALL_ACCOUNTS) params.delete("accountId");
    else params.set("accountId", accountId);
    const query = params.toString();
    startTransition(() => {
      setSelectedAccountId(accountId);
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <label htmlFor={selectId} className="shrink-0 text-xs font-medium text-muted-foreground sm:text-[13px]">
        {t("accountSwitcher")}
      </label>
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <select
          id={selectId}
          value={selectedAccountId}
          onChange={showAccount}
          className="w-full cursor-pointer appearance-none truncate rounded-[10px] border border-border bg-card py-[9px] ps-3.5 pe-9 text-xs sm:rounded-[11px] sm:py-2 sm:text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {page === "transactions" && <option value={ALL_ACCOUNTS}>{t("allAccounts")}</option>}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
          {archivedAccounts.length > 0 && (
            <optgroup label={t("archived")}>
              {archivedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </optgroup>
          )}
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
