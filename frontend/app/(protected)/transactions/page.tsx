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
import { ClearFiltersLink, TransactionFilterBar } from "@/components/transactions/transaction-filters";
import {
  EditTransactionButton,
  NewTransactionButton,
  type AccountOption,
} from "@/components/transactions/transaction-form-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
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
import {
  DEFAULT_FILTERS,
  isFiltered,
  pageNumbers,
  parseTransactionFilters,
  transactionsApiQuery,
  transactionsHref,
} from "@/lib/transaction-filters";
import type { Account, AccountBalance, Transaction, TransactionPage } from "@/lib/types";

const TYPE_FILTERS = ["all", "income", "expense", "transfer"] as const;

// The list heading takes focus after a delete removes the focused row's button, and after clearing the filters.
const LIST_HEADING_ID = "transactions-heading";


type SearchParams = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** The account requested with `?accountId=`; an empty or repeated one counts as none (all accounts). */
const requestedAccountId = (accountId: string | string[] | undefined) =>
  typeof accountId === "string" && accountId !== "" ? accountId : undefined;

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
  const [params, activeCategories] = await Promise.all([searchParams, getCategories()]);
  const selectedAccountId = requestedAccountId(params.accountId);
  // An unknown category would be a 404 from the backend, so it is checked against the user's categories.
  const filters = parseTransactionFilters(
    params,
    activeCategories.map((category) => category.id),
  );
  const accountQuery: Record<string, string> = selectedAccountId === undefined ? {} : { accountId: selectedAccountId };
  const transactionPage = (page: number) =>
    fetchApiServer<TransactionPage>(
      `/transactions?${transactionsApiQuery(filters, selectedAccountId, (page - 1) * filters.pageSize)}`,
    );

  if (selectedAccountId === undefined) {
    const [cookieStore, activeAccounts, archivedAccounts] = await Promise.all([
      cookies(),
      getAccounts(),
      getArchivedAccounts(),
    ]);
    const lastAccountId = cookieStore.get(LAST_ACCOUNT_COOKIE)?.value;
    if ([...activeAccounts, ...archivedAccounts].some((account) => account.id === lastAccountId)) {
      redirect(transactionsHref(filters, lastAccountId));
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
    currencies,
    activeAccounts,
    archivedAccounts,
    balanceMinor,
  ] = await Promise.all([
    getTranslations("transactions"),
    getFormatter(),
    getLocale(),
    selectedAccountId === undefined ? undefined : getAccount(selectedAccountId),
    transactionPage(filters.page),
    // Unfiltered, so the subtitle counts all the account's transactions whatever the filters.
    fetchApiServer<TransactionPage>(`/transactions?${new URLSearchParams({ ...accountQuery, limit: "1" })}`),
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
  const pageCount = Math.max(Math.ceil(requestedPage.total / filters.pageSize), 1);
  const page = requestedPage.items.length === 0 ? Math.min(filters.page, pageCount) : filters.page;
  const offset = (page - 1) * filters.pageSize;
  // Money in / Money out are the sums of every filtered match, not only of this page.
  const { items, total, moneyInMinor, moneyOutMinor } =
    page === filters.page ? requestedPage : await transactionPage(page).catch(notFoundOnMissingResource);
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

  const statNote = isFiltered(filters) ? t("filteredOnly") : undefined;

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
  const pageHref = (pageNumber: number) => transactionsHref({ ...filters, page: pageNumber }, account?.id);

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

      <LiveStatusProvider>
        <TransactionFilterBar
          filters={filters}
          accountId={account?.id}
          accounts={activeAccounts}
          archivedAccounts={archivedAccounts}
          categories={categoryOptions}
          currencyCode={pageAccountOption?.currencyCode}
          // ponytail: all catalogue currencies have 2 decimals; across accounts with mixed decimals the
          // amount range would need one per currency.
          minorUnit={pageAccountOption?.minorUnit ?? 2}
          total={total}
          page={page}
          pageCount={pageCount}
          focusAfterClearId={LIST_HEADING_ID}
        />

        <Card as="section" aria-labelledby={LIST_HEADING_ID}>
          <h2
            id={LIST_HEADING_ID}
            tabIndex={-1}
            className="focus-ring mx-4 mt-4 mb-2 w-fit rounded-sm text-[15px] font-semibold sm:mx-6 sm:mt-5 sm:mb-3 sm:text-base"
          >
            {t("listTitle")}
          </h2>

          {visible.length === 0 ? (
            isFiltered(filters) ? (
              <div className="px-4 py-8 sm:px-6 sm:py-10">
                <EmptyState>{t("noMatches")}</EmptyState>
                <ClearFiltersLink
                  href={transactionsHref(DEFAULT_FILTERS, account?.id)}
                  focusId={LIST_HEADING_ID}
                  className={buttonClassName("outline", "mx-auto mt-4 max-w-xs")}
                >
                  {t("search.clear")}
                </ClearFiltersLink>
              </div>
            ) : (
              <EmptyState className="px-4 py-8 sm:px-6 sm:py-10">{account ? t("empty") : t("emptyAll")}</EmptyState>
            )
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
            {/* Not a live region: the filter bar announces the results of every new page. */}
            <p className="text-xs text-muted-foreground sm:text-[13px]">
              {items.length === 0
                ? t("showing", { shown: 0, total })
                : t("showingRange", { from: offset + 1, to: offset + items.length, total })}
            </p>
            {pageCount > 1 && (
              <nav aria-label={t("pagination")} className="flex items-center gap-2">
                <PageLink href={pageHref(Math.max(page - 1, 1))} disabled={page === 1}>
                  <ChevronLeft size={14} aria-hidden className="shrink-0 rtl:-scale-x-100" />
                  {t("previous")}
                </PageLink>
                {/* Page numbers don't fit a phone screen; it shows "Page 2 of 9" instead. */}
                <span className="px-1 text-xs whitespace-nowrap text-muted-foreground sm:hidden">
                  {t("pageOf", { page, pages: pageCount })}
                </span>
                <ul className="hidden items-center gap-1 sm:flex">
                  {pageNumbers(page, pageCount).map((pageNumber, index) =>
                    pageNumber === null ? (
                      <li key={`gap-${index}`} aria-hidden className="px-1 text-muted-foreground">
                        …
                      </li>
                    ) : (
                      <li key={pageNumber}>
                        <PageLink
                          href={pageHref(pageNumber)}
                          current={pageNumber === page}
                          label={t("goToPage", { page: pageNumber })}
                        >
                          {format.number(pageNumber)}
                        </PageLink>
                      </li>
                    ),
                  )}
                </ul>
                <PageLink href={pageHref(Math.min(page + 1, pageCount))} disabled={page === pageCount}>
                  {t("next")}
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
 * "Previous", "Next" or a page number. On the first or last page "Previous" and "Next" stay links marked as
 * disabled instead of disappearing, so the focus stays on them after the click that reached that page.
 */
function PageLink({
  href,
  disabled = false,
  current = false,
  label,
  children,
}: {
  href: string;
  disabled?: boolean;
  current?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-[8px] border border-border px-3 text-[13px] font-medium tabular-nums hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground focus-ring"
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
