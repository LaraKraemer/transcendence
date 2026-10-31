import { Archive, Banknote, ChevronDown, Landmark, PiggyBank, Wallet, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { CreateAccountForm } from "@/components/accounts/account-form";
import { AccountRowActions, UnarchiveButton } from "@/components/accounts/account-row-actions";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { fetchApiServer, getAccounts, getArchivedAccounts, getCurrencies } from "@/lib/dal";
import { formatAmount } from "@/lib/format";
import type { Account, AccountBalance } from "@/lib/types";
import type { AccountType } from "@/lib/validation";

// `null` when the balance request failed: a wrong number that looks right is
// worse than none in a money app, so the UI says "unavailable" instead.
// Focus lands on the list heading after an archived or restored row disappears.
const ACCOUNTS_HEADING_ID = "accounts-heading";
// Neutral badge colours, used by cash accounts and archived rows.
const MUTED_STYLE = "bg-muted text-muted-foreground";

type AccountWithBalance = Account & { balanceMinor: number | null };

const TYPE_STYLE: Record<AccountType, { icon: LucideIcon; className: string }> = {
  checking: { icon: Wallet, className: "bg-accent text-primary dark:text-accent-foreground" },
  savings: { icon: PiggyBank, className: "bg-success-bg text-success" },
  cash: { icon: Banknote, className: MUTED_STYLE },
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("accountsTitle") };
}

/** Adds each account's current balance (`null` if that request fails). */
async function withBalances(accounts: Account[]): Promise<AccountWithBalance[]> {
  const balances = await Promise.all(
    accounts.map((account) =>
      fetchApiServer<AccountBalance>(`/accounts/${account.id}/balance`).then(
        (balance) => balance.balanceMinor,
        () => null,
      ),
    ),
  );
  return accounts.map((account, i) => ({ ...account, balanceMinor: balances[i] ?? null }));
}

/**
 * Accounts overview: stat cards and the account list, styled after the cards
 * and "Connected Wallets" rows in docs/design/desktop/profile.html. Rendered
 * inside the app shell, which provides navigation, the user card and the
 * language/theme switchers.
 */
export default async function AccountsPage() {
  const [t, locale, accounts, archivedAccounts, currencies] = await Promise.all([
    getTranslations("accounts"),
    getLocale(),
    getAccounts().then(withBalances),
    getArchivedAccounts().then(withBalances),
    getCurrencies(),
  ]);

  // Accounts may use codes outside the catalogue; those fall back to the common 2 decimals.
  const minorUnits = new Map(currencies.map((c) => [c.code, c.minorUnit]));
  const money = (amountMinor: number, currency: string) =>
    formatAmount(amountMinor, currency, minorUnits.get(currency) ?? 2, locale);

  // Balances in different currencies can't be added up, so total each currency
  // separately. With any balance unavailable the total would be wrong, so none is shown.
  const totals = new Map<string, number>();
  const allBalancesKnown = accounts.every((account) => account.balanceMinor !== null);
  for (const account of accounts) {
    totals.set(account.currencyCode, (totals.get(account.currencyCode) ?? 0) + (account.balanceMinor ?? 0));
  }

  return (
    // A <div>, not <main>: the app shell already wraps every page in <main id="main">.
    <LiveStatusProvider>
      <div className="mx-auto w-full max-w-5xl pt-2">
        <div className="mb-6">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="flex flex-col gap-5">
          {/* grid-cols-1 = minmax(0, 1fr): without it the column grows to the longest
            unbreakable text and the page gets wider than a phone screen. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <StatCard
              icon={Wallet}
              iconClassName="bg-accent text-primary dark:text-accent-foreground"
              value={t("count", { count: accounts.length })}
              label={accounts.map((account) => account.name).join(", ")}
            />
            <StatCard
              icon={Landmark}
              iconClassName="bg-success-bg text-success"
              value={
                totals.size === 0 || !allBalancesKnown
                  ? "—"
                  : // Each amount stays on one line ("-KWD 1.005" must not break after the minus);
                    // the list only wraps between currencies.
                    [...totals].map(([currency, minor], index) => (
                      <Fragment key={currency}>
                        {index > 0 && " · "}
                        <span className="whitespace-nowrap">{money(minor, currency)}</span>
                      </Fragment>
                    ))
              }
              label={t("totalBalance")}
            />
          </div>

          <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={ACCOUNTS_HEADING_ID} tabIndex={-1} className="text-base font-semibold outline-none">
                {t("listTitle")}
              </h2>
              <CreateAccountForm currencies={currencies} />
            </div>

            {accounts.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="mt-1.5">
                {accounts.map((account) => (
                  <AccountRow key={account.id} account={account} money={money}>
                    <AccountRowActions
                      account={account}
                      minorUnit={minorUnits.get(account.currencyCode) ?? 2}
                      headingId={ACCOUNTS_HEADING_ID}
                    />
                  </AccountRow>
                ))}
              </ul>
            )}
          </section>

          {archivedAccounts.length > 0 && (
            <details className="group rounded-lg border border-transparent p-4 open:border-border open:bg-card sm:p-6">
              <summary
                className="-mx-3 flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-[9px] px-3 text-muted-foreground transition-colors group-open:bg-muted hover:bg-amber-100 hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-amber-950 dark:hover:text-amber-200 [&::-webkit-details-marker]:hidden"
              >
                <Archive size={18} aria-hidden />
                <h2>{t("archivedTitle", { count: archivedAccounts.length })}</h2>
                <ChevronDown size={17} aria-hidden className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <ul className="mt-1.5">
                {archivedAccounts.map((account) => (
                  <AccountRow key={account.id} account={account} money={money} archived>
                    <UnarchiveButton account={account} headingId={ACCOUNTS_HEADING_ID} />
                  </AccountRow>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </LiveStatusProvider>
  );
}

/**
 * One account row: icon, name linking to its transactions, type (or "Archived")
 * badge, balance, and the row's actions passed as `children`.
 */
async function AccountRow({
  account,
  money,
  archived = false,
  children,
}: {
  account: AccountWithBalance;
  money: (amountMinor: number, currency: string) => string;
  archived?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations("accounts");
  const { icon: Icon, className } = TYPE_STYLE[account.type];
  return (
    <li
      // flex-wrap: the edit form (and, on phones, the action buttons) take their own line.
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border py-3.5 last:border-b-0"
    >
      <span
        className={`flex size-9.5 shrink-0 items-center justify-center rounded-[10px] ${archived ? MUTED_STYLE : className}`}
      >
        <Icon size={17} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {/* Wraps the badge under the name on narrow screens instead of squeezing the name. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/transactions?accountId=${account.id}`}
            className="max-w-full truncate text-sm font-semibold hover:underline"
          >
            {account.name}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${archived ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : className}`}
          >
            {archived ? t("archived") : t(`types.${account.type}`)}
          </span>
        </div>
        <div className="truncate text-[13px] text-muted-foreground">
          {account.institution ? `${account.currencyCode} · ${account.institution}` : account.currencyCode}
        </div>
      </div>
      {account.balanceMinor === null ? (
        <span className="ms-auto shrink-0 text-[13px] text-muted-foreground">{t("balanceUnavailable")}</span>
      ) : (
        <span
          className={`ms-auto shrink-0 text-sm font-semibold ${account.balanceMinor < 0 ? "text-destructive" : ""}`}
        >
          {money(account.balanceMinor, account.currencyCode)}
        </span>
      )}
      {children}
    </li>
  );
}

function StatCard({
  icon: Icon,
  iconClassName,
  value,
  label,
}: {
  icon: LucideIcon;
  iconClassName: string;
  value: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-lg border border-border bg-card p-5">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="min-w-0">
        {/* Wraps rather than truncates: a money total must never be cut off. */}
        <div className="text-[15px] font-semibold break-words">{value}</div>
        {label && <div className="truncate text-[13px] text-muted-foreground">{label}</div>}
      </div>
    </div>
  );
}
