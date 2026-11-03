import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ImportTransactionsButton } from "@/components/transactions/import-transactions-button";
import { AccountSwitcher } from "@/components/transactions/account-switcher";
import { DeleteTransactionButton } from "@/components/transactions/delete-transaction-button";
import {
  EditTransactionButton,
  NewTransactionButton,
  type AccountOption,
} from "@/components/transactions/transaction-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import type { Account, AccountBalance, Transaction, TransactionPage } from "@/lib/types";

const PAGE_SIZE = 50;
// Money in / Money out add up the newest transactions of the account, whatever the filter and page.
const STATS_LIMIT = 200;

const TYPE_FILTERS = ["all", "income", "expense", "transfer"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// The list heading takes focus after a delete removes the focused row's button.
const LIST_HEADING_ID = "transactions-heading";


type SearchParams = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** The account requested with `?accountId=`; an empty or repeated one counts as none (all accounts). */
const requestedAccountId = (accountId: string | string[] | undefined) =>
  typeof accountId === "string" && accountId !== "" ? accountId : undefined;

/** The `?offset=` of the page; anything but a non-negative integer counts as the first page. */
const requestedOffset = (offset: string | string[] | undefined) =>
  typeof offset === "string" && /^\d+$/.test(offset) && Number.isSafeInteger(Number(offset)) ? Number(offset) : 0;

/** This page for one account (or all accounts) with a type filter, from the transaction at `offset` on. */
function transactionsHref(accountId: string | undefined, filter: TypeFilter, offset = 0) {
  const query = new URLSearchParams({
    ...(accountId === undefined ? {} : { accountId }),
    ...(filter === "all" ? {} : { type: filter }),
    ...(offset === 0 ? {} : { offset: String(offset) }),
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
  const { accountId, type, offset: offsetParam } = await searchParams;
  const filter: TypeFilter = type === "income" || type === "expense" || type === "transfer" ? type : "all";
  const selectedAccountId = requestedAccountId(accountId);
  const requestedPageOffset = requestedOffset(offsetParam);
  const accountQuery: Record<string, string> = selectedAccountId === undefined ? {} : { accountId: selectedAccountId };
  const transactionPage = (pageOffset: number) =>
    fetchApiServer<TransactionPage>(
      `/transactions?${new URLSearchParams({
        ...accountQuery,
        ...(filter === "all" ? {} : { type: filter }),
        limit: String(PAGE_SIZE),
        offset: String(pageOffset),
      })}`,
    );

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
    requestedPage,
    overview,
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
    transactionPage(requestedPageOffset),
    // Unfiltered, so the subtitle and the stat cards don't change with the filter or the page. All accounts
    // have no stat cards and need only the total.
    fetchApiServer<TransactionPage>(
      `/transactions?${new URLSearchParams({
        ...accountQuery,
        limit: String(selectedAccountId === undefined ? 1 : STATS_LIMIT),
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
  // Past the last page (e.g. its only row was deleted) the last page is shown. A redirect would unmount the
  // deleted row's button before it moves the focus to the list heading.
  const lastPageOffset = Math.floor(Math.max(requestedPage.total - 1, 0) / PAGE_SIZE) * PAGE_SIZE;
  const offset =
    requestedPage.items.length === 0 ? Math.min(requestedPageOffset, lastPageOffset) : requestedPageOffset;
  const { items, total } =
    offset === requestedPageOffset ? requestedPage : await transactionPage(offset).catch(notFoundOnMissingResource);
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

  const moneyInMinor = overview.items.reduce((sum, tx) => (tx.amountMinor > 0 ? sum + tx.amountMinor : sum), 0);
  const moneyOutMinor = overview.items.reduce((sum, tx) => (tx.amountMinor < 0 ? sum + tx.amountMinor : sum), 0);
  const statNote = overview.total > overview.items.length ? t("latestOnly", { count: overview.items.length }) : undefined;

  // Across all accounts a transfer is one item: its source leg, with the other leg's account and amount.
  const transferTo = (tx: Transaction) =>
    !account && tx.transferAccountId && tx.transferAmountMinor != null
      ? { account: accountOptions.get(tx.transferAccountId), amountMinor: tx.transferAmountMinor }
      : undefined;
  // A row whose account is missing (created after the account lists were loaded) is skipped until the next load.
  const visible = items.filter((tx) => {
    const to = transferTo(tx);
    return accountOptions.has(tx.accountId) && (to === undefined || to.account !== undefined);
  });
  const newerOffset = offset > 0 ? Math.max(offset - PAGE_SIZE, 0) : undefined;
  const olderOffset = offset + items.length < total ? offset + items.length : undefined;
  // Counted from the offset, so a hand-edited `?offset=` that is not a multiple of PAGE_SIZE still adds up.
  const pageNumber = Math.ceil(offset / PAGE_SIZE) + 1;
  const pageCount = pageNumber + Math.ceil(Math.max(total - offset - items.length, 0) / PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      {/* User-entered text (names, descriptions, notes) is wrapped in <bdi>, so Latin text in an RTL
          page (or the reverse) keeps its punctuation in place without changing the alignment. */}
      <div className="mb-[18px] flex items-start gap-4 sm:mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-title break-words">
              {account
                ? t.rich("heading", { account: account.name, name: (chunks) => <bdi>{chunks}</bdi> })
                : t("listTitle")}
            </h1>
            {account?.isArchived && (
              <Badge>{t("archived")}</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {account
              ? t("subtitle", { count: overview.total, currency: account.currencyCode })
              : t("allSubtitle", { count: overview.total })}
          </p>
        </div>
      </div>

      {activeAccountOptions.length > 0 && (
        <div className="mb-4 flex w-fit flex-wrap items-center gap-3">
          <ImportTransactionsButton key={account?.id ?? "all"} accounts={activeAccountOptions} selectedAccountId={account?.isArchived ? undefined : account?.id} />
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
      )}

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
              className="flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[13px] font-medium sm:flex-none text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm focus-ring"
            >
              {t(`filters.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      <LiveStatusProvider>
        <Card as="section" aria-labelledby={LIST_HEADING_ID}>
          <h2
            id={LIST_HEADING_ID}
            tabIndex={-1}
            className="focus-ring mx-4 mt-4 mb-2 w-fit rounded-sm text-[15px] font-semibold sm:mx-6 sm:mt-5 sm:mb-3 sm:text-base"
          >
            {t("listTitle")}
          </h2>

          {visible.length === 0 ? (
            <EmptyState className="px-4 py-8 sm:px-6 sm:py-10">
              {filter !== "all" ? t("emptyFiltered", { filter }) : account ? t("empty") : t("emptyAll")}
            </EmptyState>
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
                {visible.map((tx) => {
                  const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
                  const description = transactionLabel(tx, category?.name, t(`form.types.${tx.type}`));
                  // Both are present: rows of unknown accounts were skipped above.
                  const txAccount = accountOptions.get(tx.accountId)!;
                  const transfer = transferTo(tx);
                  const toAccount = transfer?.account;
                  // A transfer leg in one account's list names the account on the other side.
                  const otherLegAccount =
                    account && tx.transferAccountId ? accountOptions.get(tx.transferAccountId) : undefined;
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
                          toAccount ? "" : tx.amountMinor > 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {/* A transfer moves money between accounts, so its amount has no sign or colour. */}
                        {!transfer || !toAccount ? (
                          <span className="whitespace-nowrap">{money(tx.amountMinor, txAccount, "exceptZero")}</span>
                        ) : txAccount.currencyCode === toAccount.currencyCode ? (
                          <span className="whitespace-nowrap">{money(transfer.amountMinor, toAccount)}</span>
                        ) : (
                          <TransferRoute
                            label={t("transferRoute", {
                              from: money(-tx.amountMinor, txAccount),
                              to: money(transfer.amountMinor, toAccount),
                            })}
                            from={<span className="whitespace-nowrap">{money(-tx.amountMinor, txAccount)}</span>}
                            to={<span className="whitespace-nowrap">{money(transfer.amountMinor, toAccount)}</span>}
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

          <div className="flex flex-col items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-between sm:px-6 sm:py-4">
            <p aria-live="polite" className="text-xs text-muted-foreground sm:text-[13px]">
              {items.length === 0
                ? t("showing", { shown: 0, total })
                : t("showingRange", { from: offset + 1, to: offset + items.length, total })}
            </p>
            {(newerOffset !== undefined || olderOffset !== undefined) && (
              <nav aria-label={t("pagination")} className="flex items-center gap-2">
                <PageLink
                  href={transactionsHref(account?.id, filter, newerOffset ?? offset)}
                  disabled={newerOffset === undefined}
                >
                  <ChevronLeft size={14} aria-hidden className="shrink-0 rtl:-scale-x-100" />
                  {t("newer")}
                </PageLink>
                <span className="px-1 text-xs whitespace-nowrap text-muted-foreground sm:text-[13px]">
                  {t("pageOf", { page: pageNumber, pages: pageCount })}
                </span>
                <PageLink
                  href={transactionsHref(account?.id, filter, olderOffset ?? offset)}
                  disabled={olderOffset === undefined}
                >
                  {t("older")}
                  <ChevronRight size={14} aria-hidden className="shrink-0 rtl:-scale-x-100" />
                </PageLink>
              </nav>
            )}
          </div>
        </Card>
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

      <Card as="section" className="px-4 py-8 sm:px-6 sm:py-10">
        <EmptyState href="/accounts">{t("accounts.empty")}</EmptyState>
      </Card>
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

/**
 * "Newer" or "Older". On the first or last page it stays a link marked as disabled instead of disappearing,
 * so the focus stays on it after the click that reached that page.
 */
function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className="inline-flex min-h-9 items-center gap-1 rounded-[8px] border border-border px-3 text-[13px] font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50 focus-ring"
    >
      {children}
    </Link>
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
    <Card className={`flex items-center gap-4 p-3.5 sm:p-5 ${className}`}>
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
    </Card>
  );
}
