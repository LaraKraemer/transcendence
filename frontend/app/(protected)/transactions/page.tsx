import { ArrowDownLeft, ArrowRight, ArrowUpRight, Store, Wallet, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccountSwitcher } from "@/components/transactions/account-switcher";
import { DeleteTransactionButton } from "@/components/transactions/delete-transaction-button";
import {
  EditTransactionButton,
  NewTransactionButton,
  type AccountOption,
} from "@/components/transactions/transaction-form-dialog";
import { LiveStatusProvider } from "@/components/ui/live-status";
import {
  fetchApiServer,
  getAccount,
  getAccounts,
  getArchivedAccounts,
  getCategories,
  getCurrencies,
  notFoundOnMissingResource,
} from "@/lib/dal";
import { formatAmount, transactionLabel } from "@/lib/format";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import { groupTransferLegs } from "@/lib/transactions";
import type { Account, AccountBalance, Transaction, TransactionPage } from "@/lib/types";

const TRANSACTIONS_LIMIT = 200;

const TYPE_FILTERS = ["all", "income", "expense", "transfer"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// The list heading takes focus after a delete removes the focused row's button.
const LIST_HEADING_ID = "transactions-heading";

const focusRing = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

type SearchParams = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** The account requested with `?accountId=`; an empty or repeated one counts as none (all accounts). */
const requestedAccountId = (accountId: string | string[] | undefined) =>
  typeof accountId === "string" && accountId !== "" ? accountId : undefined;

/** This page for one account (or all accounts) with a type filter. */
function transactionsHref(accountId: string | undefined, filter: TypeFilter) {
  const query = new URLSearchParams({
    ...(accountId === undefined ? {} : { accountId }),
    ...(filter === "all" ? {} : { type: filter }),
  }).toString();
  return query ? `/transactions?${query}` : "/transactions";
}

export async function generateMetadata({ searchParams }: SearchParams): Promise<Metadata> {
  const [{ accountId }, t] = await Promise.all([searchParams, getTranslations()]);
  const selectedAccountId = requestedAccountId(accountId);
  if (selectedAccountId === undefined) return { title: t("nav.transactions") };
  // A missing account shows the 404 page, with its title instead of "Transactions".
  const account = await getAccount(selectedAccountId).catch(notFoundOnMissingResource);
  return { title: t("metadata.accountTransactionsTitle", { account: account.name }) };
}

/**
 * The transactions of one account (`?accountId=`), or of all accounts. Without an accountId it opens the
 * last used account (the lastAccountId cookie, written by the account switcher), otherwise all accounts.
 */
export default async function TransactionsPage({ searchParams }: SearchParams) {
  const { accountId, type } = await searchParams;
  const filter: TypeFilter = type === "income" || type === "expense" || type === "transfer" ? type : "all";
  const selectedAccountId = requestedAccountId(accountId);

  if (selectedAccountId === undefined) {
    const [cookieStore, activeAccounts, archivedAccounts] = await Promise.all([
      cookies(),
      getAccounts(),
      getArchivedAccounts(),
    ]);
    const lastAccountId = cookieStore.get(LAST_ACCOUNT_COOKIE)?.value;
    if ([...activeAccounts, ...archivedAccounts].some((account) => account.id === lastAccountId)) {
      redirect(transactionsHref(lastAccountId, filter));
    }
    if (activeAccounts.length === 0 && archivedAccounts.length === 0) return <NoAccounts />;
  }

  const [
    t,
    format,
    locale,
    account,
    { items, total },
    activeCategories,
    currencies,
    activeAccounts,
    archivedAccounts,
    balanceMinor,
  ] = await Promise.all([
    getTranslations("transactions"),
    getFormatter(),
    getLocale(),
    selectedAccountId === undefined ? undefined : getAccount(selectedAccountId),
    fetchApiServer<TransactionPage>(
      `/transactions?${new URLSearchParams({
        ...(selectedAccountId === undefined ? {} : { accountId: selectedAccountId }),
        limit: String(TRANSACTIONS_LIMIT),
      })}`,
    ),
    getCategories(),
    getCurrencies(),
    getAccounts(),
    getArchivedAccounts(),
    selectedAccountId === undefined
      ? null
      : fetchApiServer<AccountBalance>(`/accounts/${encodeURIComponent(selectedAccountId)}/balance`).then(
          (balance) => balance.balanceMinor,
          () => null,
        ),
  ]).catch(notFoundOnMissingResource);
  const categories = new Map(activeCategories.map((c) => [c.id, c]));
  // Transfer legs have no category, so they are labelled by their type instead of "Uncategorised".
  const noCategoryLabel = (tx: Transaction) => (tx.type === "transfer" ? t("form.types.transfer") : t("uncategorised"));

  const minorUnits = new Map(currencies.map((currency) => [currency.code, currency.minorUnit]));
  const toAccountOption = ({ id, name, currencyCode }: Account): AccountOption => ({
    id,
    name,
    currencyCode,
    minorUnit: minorUnits.get(currencyCode) ?? 2,
  });
  // Built once and passed to every row: the same object is sent to the client only once.
  const activeAccountOptions = activeAccounts.map(toAccountOption);
  const accountOptions = new Map(
    [...activeAccountOptions, ...archivedAccounts.map(toAccountOption)].map((option) => [option.id, option]),
  );
  const pageAccountOption = account && (accountOptions.get(account.id) ?? toAccountOption(account));
  const categoryOptions = activeCategories.map(({ id, name, types }) => ({ id, name, types }));
  const money = (amountMinor: number, { currencyCode, minorUnit }: AccountOption, signDisplay?: "exceptZero") =>
    formatAmount(amountMinor, currencyCode, minorUnit, locale, signDisplay);

  const bookedOn = (date: string) =>
    format.dateTime(new Date(date), { dateStyle: "medium", timeZone: "UTC", calendar: "gregory" });

  const moneyInMinor = items.reduce((sum, tx) => (tx.amountMinor > 0 ? sum + tx.amountMinor : sum), 0);
  const moneyOutMinor = items.reduce((sum, tx) => (tx.amountMinor < 0 ? sum + tx.amountMinor : sum), 0);
  const statNote = total > items.length ? t("latestOnly", { count: items.length }) : undefined;

  // Only all accounts contain both legs of a transfer; they are shown as one row. A row whose account is
  // missing (created after the account lists were loaded) is skipped until the next load.
  const hasAccount = (tx: Transaction | undefined) => tx === undefined || accountOptions.has(tx.accountId);
  const rows = groupTransferLegs(items).filter(
    ({ transaction, transferTo }) => hasAccount(transaction) && hasAccount(transferTo),
  );
  // ponytail: total counts each leg, so when the list is cut at TRANSACTIONS_LIMIT, transfers that were
  // not loaded still count twice. Upgrade path: let the backend count a transfer group once.
  const rowTotal = total - (items.length - rows.length);
  const visible = filter === "all" ? rows : rows.filter(({ transaction }) => transaction.type === filter);

  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      {/* User-entered text (names, descriptions, notes) is wrapped in <bdi>, so Latin text in an RTL
          page (or the reverse) keeps its punctuation in place without changing the alignment. */}
      <div className="mb-[18px] flex items-start gap-4 sm:mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[26px] font-bold tracking-[-0.02em] break-words">
              {account
                ? t.rich("heading", { account: account.name, name: (chunks) => <bdi>{chunks}</bdi> })
                : t("listTitle")}
            </h1>
            {account?.isArchived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t("archived")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {account
              ? t("subtitle", { count: total, currency: account.currencyCode })
              : t("allSubtitle", { count: rowTotal })}
          </p>
        </div>
        {!account?.isArchived && activeAccountOptions.length > 0 && (
          <LiveStatusProvider>
            <NewTransactionButton
              variant="header"
              accounts={pageAccountOption ? [pageAccountOption] : activeAccountOptions}
              allAccounts={activeAccountOptions}
              categories={categoryOptions}
            />
          </LiveStatusProvider>
        )}
      </div>

      {/* Amounts in different currencies can't be added up, so the totals are for one account only. */}
      {pageAccountOption && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:mb-5 sm:grid-cols-3 sm:gap-5">
          <StatCard
            icon={ArrowDownLeft}
            iconClassName="bg-success-bg text-success rtl:-scale-x-100"
            label={t("moneyIn")}
            value={money(moneyInMinor, pageAccountOption, "exceptZero")}
            valueClassName="text-success"
            note={statNote}
          />
          <StatCard
            icon={ArrowUpRight}
            iconClassName="bg-danger-bg text-destructive rtl:-scale-x-100"
            label={t("moneyOut")}
            value={money(moneyOutMinor, pageAccountOption, "exceptZero")}
            valueClassName="text-destructive"
            note={statNote}
          />
          <StatCard
            icon={Wallet}
            iconClassName="bg-muted text-muted-foreground"
            label={t("balance")}
            // No "exceptZero": a "+" suits in/out amounts but not a balance.
            value={balanceMinor === null ? "—" : money(balanceMinor, pageAccountOption)}
            valueClassName={balanceMinor !== null && balanceMinor < 0 ? "text-destructive" : ""}
            note={balanceMinor === null ? t("balanceUnavailable") : undefined}
            className="max-sm:col-span-2"
          />
        </div>
      )}

      <div className="mb-3.5 flex flex-col gap-3 sm:mb-5 sm:flex-row-reverse sm:items-center sm:justify-between">
        <AccountSwitcher
          accounts={activeAccounts}
          archivedAccounts={archivedAccounts}
          currentAccountId={account?.id}
        />
        <nav
          aria-label={t("filterLabel")}
          className="flex flex-wrap gap-1 rounded-[11px] border border-border bg-muted p-1 sm:inline-flex"
        >
          {TYPE_FILTERS.map((option) => (
            <Link
              key={option}
              href={transactionsHref(account?.id, option)}
              scroll={false}
              aria-current={option === filter ? "page" : undefined}
              className={`flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[13px] font-medium sm:flex-none text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm ${focusRing}`}
            >
              {t(`filters.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      <LiveStatusProvider>
        <section aria-labelledby={LIST_HEADING_ID} className="rounded-lg border border-border bg-card">
          <h2
            id={LIST_HEADING_ID}
            tabIndex={-1}
            className={`mx-4 mt-4 mb-2 w-fit rounded-sm text-[15px] font-semibold sm:mx-6 sm:mt-5 sm:mb-3 sm:text-base ${focusRing}`}
          >
            {t("listTitle")}
          </h2>

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-6 sm:py-10 sm:text-sm">
              {total > 0 ? t("emptyFiltered", { filter }) : account ? t("empty") : t("emptyAll")}
            </p>
          ) : (
            <table className="w-full text-[13px] sm:text-sm">
              <caption className="sr-only">
                {account ? t("caption", { account: account.name }) : t("captionAll")}
              </caption>
              <thead>
                <tr className="bg-muted text-[11px] font-semibold tracking-[.06em] wrap-anywhere text-muted-foreground uppercase">
                  <th scope="col" className="py-2 ps-4 pe-3 text-start sm:py-3 sm:ps-6">
                    {t("columns.description")}
                  </th>
                  {!account && (
                    <th scope="col" className="hidden px-3 py-3 text-start lg:table-cell">
                      {t("columns.account")}
                    </th>
                  )}
                  <th scope="col" className="hidden px-3 py-3 text-start lg:table-cell">
                    {t("columns.category")}
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-start lg:table-cell">
                    {t("columns.date")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end sm:px-3 sm:py-3">
                    {t("columns.amount")}
                  </th>
                  <th scope="col" className="py-2 ps-1 pe-2 sm:py-3 sm:pe-4">
                    <span className="sr-only">{t("columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ transaction: tx, transferTo }) => {
                  const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
                  const description = transactionLabel(tx, category?.name, t(`form.types.${tx.type}`));
                  // Both are present: rows of unknown accounts were skipped above.
                  const txAccount = accountOptions.get(tx.accountId)!;
                  const toAccount = transferTo && accountOptions.get(transferTo.accountId)!;
                  // A transfer leg shown alone (one account's list) names the account on the other side.
                  const otherLegAccount =
                    !transferTo && tx.transferAccountId ? accountOptions.get(tx.transferAccountId) : undefined;
                  const accountLabel = toAccount ? (
                    <TransferRoute
                      label={t("transferRoute", { from: txAccount.name, to: toAccount.name })}
                      from={<bdi>{txAccount.name}</bdi>}
                      to={<bdi>{toAccount.name}</bdi>}
                    />
                  ) : (
                    <bdi>{txAccount.name}</bdi>
                  );
                  return (
                    <tr key={tx.id} className="border-t border-border">
                      <td className="py-[11px] ps-4 pe-3 sm:py-3.5 sm:ps-6">
                        <div className="font-semibold wrap-anywhere">
                          <bdi>{description}</bdi>
                        </div>
                        {tx.description && tx.merchant && (
                          <div className="flex items-center gap-1 text-xs wrap-anywhere text-muted-foreground sm:text-[13px]">
                            <Store size={12} aria-hidden className="shrink-0" />
                            <span className="sr-only">{t("merchant")}: </span>
                            <bdi className="min-w-0">{tx.merchant}</bdi>
                          </div>
                        )}
                        {otherLegAccount && (
                          <div className="flex items-center gap-1 text-xs wrap-anywhere text-muted-foreground sm:text-[13px]">
                            {tx.amountMinor < 0 ? (
                              <ArrowUpRight size={12} aria-hidden className="shrink-0 rtl:-scale-x-100" />
                            ) : (
                              <ArrowDownLeft size={12} aria-hidden className="shrink-0 rtl:-scale-x-100" />
                            )}
                            <span className="min-w-0">
                              {t.rich(tx.amountMinor < 0 ? "transferTo" : "transferFrom", {
                                account: otherLegAccount.name,
                                name: (chunks) => <bdi>{chunks}</bdi>,
                              })}
                            </span>
                          </div>
                        )}
                        {tx.notes && (
                          <div className="text-xs wrap-anywhere text-muted-foreground sm:text-[13px]">
                            <bdi>{tx.notes}</bdi>
                          </div>
                        )}
                        <div className="mt-0.5 text-xs wrap-anywhere text-muted-foreground sm:text-[13px] lg:hidden">
                          {!account && (
                            <>
                              {accountLabel}
                              <span aria-hidden> · </span>
                            </>
                          )}
                          {category ? <bdi>{category.name}</bdi> : noCategoryLabel(tx)}
                          <span aria-hidden> · </span>
                          <time dateTime={tx.bookedOn}>{bookedOn(tx.bookedOn)}</time>
                        </div>
                      </td>
                      {!account && (
                        <td className="hidden px-3 py-3.5 wrap-anywhere text-muted-foreground lg:table-cell">
                          {accountLabel}
                        </td>
                      )}
                      <td className="hidden px-3 py-3.5 lg:table-cell">
                        {category ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            <bdi>{category.name}</bdi>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{noCategoryLabel(tx)}</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3.5 whitespace-nowrap text-muted-foreground lg:table-cell">
                        <time dateTime={tx.bookedOn}>{bookedOn(tx.bookedOn)}</time>
                      </td>
                      <td
                        className={`px-2 py-[11px] text-end font-semibold sm:px-3 sm:py-3.5 tabular-nums ${
                          transferTo ? "" : tx.amountMinor > 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {/* A transfer moves money between accounts, so its amount has no sign or colour. */}
                        {!transferTo || !toAccount ? (
                          <span className="whitespace-nowrap">{money(tx.amountMinor, txAccount, "exceptZero")}</span>
                        ) : txAccount.currencyCode === toAccount.currencyCode ? (
                          <span className="whitespace-nowrap">{money(transferTo.amountMinor, toAccount)}</span>
                        ) : (
                          <TransferRoute
                            label={t("transferRoute", {
                              from: money(-tx.amountMinor, txAccount),
                              to: money(transferTo.amountMinor, toAccount),
                            })}
                            from={<span className="whitespace-nowrap">{money(-tx.amountMinor, txAccount)}</span>}
                            to={<span className="whitespace-nowrap">{money(transferTo.amountMinor, toAccount)}</span>}
                            className="justify-end"
                          />
                        )}
                      </td>
                      <td className="py-[11px] ps-1 pe-2 sm:py-3.5 sm:pe-4">
                        <div className="flex justify-end gap-1.5">
                          {/* The backend can't edit transfers; they are deleted and created again. */}
                          {tx.type !== "transfer" && (
                            <EditTransactionButton
                              transaction={tx}
                              account={txAccount}
                              categories={categoryOptions}
                              focusAfterDeleteId={LIST_HEADING_ID}
                            />
                          )}
                          <DeleteTransactionButton
                            transactionId={tx.id}
                            description={description}
                            isTransfer={tx.type === "transfer"}
                            focusAfterDeleteId={LIST_HEADING_ID}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p
            aria-live="polite"
            className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6 sm:py-4 sm:text-[13px]"
          >
            {t("showing", { shown: visible.length, total: rowTotal })}
          </p>
        </section>
      </LiveStatusProvider>
    </div>
  );
}

/** A new user has no accounts yet, so there is nothing to list: the page links to /accounts. */
async function NoAccounts() {
  const t = await getTranslations();
  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      <h1 className="mb-[18px] text-[15px] font-bold tracking-[-0.02em] sm:mb-6 sm:text-[26px]">
        {t("nav.transactions")}
      </h1>

      <div className="mb-3.5 flex flex-col gap-3 sm:mb-5 sm:flex-row-reverse sm:items-center sm:justify-between">
        <AccountSwitcher accounts={[]} />
        <div
          role="group"
          aria-label={t("transactions.filterLabel")}
          aria-disabled="true"
          className="flex cursor-not-allowed flex-wrap gap-1 rounded-[11px] border border-border bg-muted p-1 opacity-50 sm:inline-flex"
        >
          {TYPE_FILTERS.map((option) => (
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
        <Link
          href="/accounts"
          className={`rounded-sm underline hover:text-foreground ${focusRing}`}
        >
          {t("accounts.empty")}
        </Link>
      </section>
    </div>
  );
}

/**
 * "from → to" for a transfer. Screen readers hear `label` ("From A to B") instead; the arrow is
 * mirrored in right-to-left languages, so it always points in the reading direction.
 */
function TransferRoute({
  label,
  from,
  to,
  className = "",
}: {
  label: string;
  from: ReactNode;
  to: ReactNode;
  className?: string;
}) {
  return (
    <>
      <span className="sr-only">{label}</span>
      <span aria-hidden className={`inline-flex flex-wrap items-center gap-x-1 ${className}`}>
        {from}
        <ArrowRight size={12} className="shrink-0 rtl:-scale-x-100" />
        {to}
      </span>
    </>
  );
}

function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  valueClassName = "",
  note,
  className = "",
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  value: string;
  valueClassName?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 rounded-lg border border-border bg-card p-3.5 sm:p-5 ${className}`}>
      <span className={`flex size-11 shrink-0 max-sm:hidden items-center justify-center rounded-xl ${iconClassName}`}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground sm:text-[13px]">{label}</div>
        <div
          className={`truncate text-base font-bold tracking-[-0.02em] tabular-nums sm:text-[22px] ${valueClassName}`}
        >
          {value}
        </div>
        {note && <div className="truncate text-xs text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}
