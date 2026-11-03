"use client";

import { ChevronDown, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
} from "react";

import { AccountSwitcher } from "@/components/transactions/account-switcher";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { choiceSegmentClassName, choiceSegmentsClassName } from "@/components/ui/choice-group";
import { useAnnounce } from "@/components/ui/live-status";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import {
  DEFAULT_FILTERS,
  MAX_SEARCH_LENGTH,
  PAGE_SIZES,
  SORT_OPTIONS,
  transactionsHref,
  type SortOption,
  type TransactionFilters,
} from "@/lib/transaction-filters";
import { TRANSACTION_TYPES, amountInputValue, filterAmountInput, toMinorUnits, type TransactionType } from "@/lib/validation";

const typingDebounceMs = 300;

const smallButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium hover:bg-muted focus-ring";

/** A link to the unfiltered list. It disappears with the empty list, so the focus moves to `focusId` first. */
export function ClearFiltersLink({ focusId, ...props }: ComponentProps<typeof Link> & { focusId: string }) {
  return <Link scroll={false} onClick={() => document.getElementById(focusId)?.focus()} {...props} />;
}

/** The text fields as typed. They apply after a pause in typing, once they are valid. */
type TypedFields = { q: string; from: string; to: string; minAmount: string; maxAmount: string };

function typedFields(filters: TransactionFilters, minorUnit: number): TypedFields {
  const amount = (amountMinor: number | null) => (amountMinor === null ? "" : amountInputValue(amountMinor, minorUnit));
  return {
    q: filters.q,
    from: filters.from,
    to: filters.to,
    minAmount: amount(filters.minAmountMinor),
    maxAmount: amount(filters.maxAmountMinor),
  };
}

/** The filters set in the "More filters" panel, so the panel can say how many are on. */
function moreFiltersCount(filters: TransactionFilters): number {
  return (["categoryId", "from", "to", "minAmountMinor", "maxAmountMinor", "sort", "pageSize"] as const).filter(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  ).length;
}

/**
 * The search box, filters and sort of /transactions. Every change goes into the URL (and resets the page
 * to 1), so the server renders the list; the result count is announced to screen readers.
 */
export function TransactionFilterBar({
  filters,
  accountId,
  accounts,
  archivedAccounts,
  categories,
  currencyCode,
  minorUnit,
  total,
  page,
  pageCount,
  focusAfterClearId,
}: {
  filters: TransactionFilters;
  accountId?: string;
  accounts: { id: string; name: string }[];
  archivedAccounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** The account's currency; amounts across all accounts are compared without one. */
  currencyCode?: string;
  minorUnit: number;
  total: number;
  page: number;
  pageCount: number;
  focusAfterClearId: string;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const announce = useAnnounce();
  const id = useId();
  const [, startTransition] = useTransition();
  const [shownFilters, setShownFilters] = useOptimistic(filters);
  const [typed, setTyped] = useState(() => typedFields(filters, minorUnit));
  const [moreOpen, setMoreOpen] = useState(() => moreFiltersCount(filters) > 0);
  // The URL this bar navigated to last, and the filters on it: a quick second change builds on the
  // first one before its page has loaded.
  const [pushedHref, setPushedHref] = useState<string | null>(null);
  const latestFilters = useRef(filters);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const href = transactionsHref(filters, accountId);
  const [syncedHref, setSyncedHref] = useState(href);
  if (href !== syncedHref) {
    setSyncedHref(href);
    // Back, Forward or a link changed the filters: show them. After this bar's own change the fields
    // keep what is typed, which may already be ahead of the URL.
    if (href !== pushedHref) setTyped(typedFields(filters, minorUnit));
  }

  // Typing that hasn't applied yet would undo such a change (e.g. go back to the previous account).
  useEffect(() => {
    if (href !== pushedHref) clearTimeout(typingTimer.current);
  }, [href, pushedHref]);

  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  // Every new URL (filters, account or page) tells screen readers how many transactions it found.
  const announcedHref = useRef(href);
  useEffect(() => {
    if (announcedHref.current === href) return;
    announcedHref.current = href;
    announce(t("search.results", { count: total, page, pages: pageCount }));
  }, [href, total, page, pageCount, announce, t]);

  const parseAmount = (amount: string) => (amount.trim() === "" ? null : toMinorUnits(amount, minorUnit, locale));
  const readTyped = (fields: TypedFields) => {
    const minAmountMinor = parseAmount(fields.minAmount);
    const maxAmountMinor = parseAmount(fields.maxAmount);
    return {
      minAmountMinor,
      maxAmountMinor,
      amountRangeInvalid:
        typeof minAmountMinor === "number" && typeof maxAmountMinor === "number" && minAmountMinor > maxAmountMinor,
      dateRangeInvalid: fields.from !== "" && fields.to !== "" && fields.from > fields.to,
    };
  };

  /** Shows the first page for the typed fields (those that are valid) plus `changes`. */
  function apply(fields: TypedFields, changes: Partial<TransactionFilters> = {}) {
    clearTimeout(typingTimer.current);
    const current = latestFilters.current;
    const { minAmountMinor, maxAmountMinor, amountRangeInvalid, dateRangeInvalid } = readTyped(fields);
    const next: TransactionFilters = {
      ...current,
      q: fields.q.trim(),
      ...(dateRangeInvalid ? {} : { from: fields.from, to: fields.to }),
      ...(amountRangeInvalid || typeof minAmountMinor === "string" ? {} : { minAmountMinor }),
      ...(amountRangeInvalid || typeof maxAmountMinor === "string" ? {} : { maxAmountMinor }),
      ...changes,
      page: 1,
    };
    // E.g. a trailing space: nothing changed, so the page stays.
    if (transactionsHref({ ...next, page: current.page }, accountId) === transactionsHref(current, accountId)) return;
    const nextHref = transactionsHref(next, accountId);
    latestFilters.current = next;
    setPushedHref(nextHref);
    startTransition(() => {
      setShownFilters(next);
      router.push(nextHref, { scroll: false });
    });
  }

  function typeInto(field: keyof TypedFields, value: string) {
    const fields = { ...typed, [field]: value };
    setTyped(fields);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => apply(fields), typingDebounceMs);
  }

  function clear() {
    const fields = typedFields(DEFAULT_FILTERS, minorUnit);
    setTyped(fields);
    apply(fields, DEFAULT_FILTERS);
    // The button disappears, so the focus moves to the list it changed.
    document.getElementById(focusAfterClearId)?.focus();
  }

  const { minAmountMinor, maxAmountMinor, amountRangeInvalid, dateRangeInvalid } = readTyped(typed);
  const amountError = (amount: number | string | null) =>
    typeof amount === "string"
      ? t(`errors.${amount as "amountInvalid" | "amountDecimals" | "amountTooLarge"}`, {
          digits: minorUnit,
          example: (12.5).toFixed(minorUnit),
        })
      : undefined;
  const canClear =
    transactionsHref({ ...shownFilters, page: 1 }) !== transactionsHref(DEFAULT_FILTERS) ||
    Object.values(typed).some((value) => value !== "");
  const moreCount = moreFiltersCount(shownFilters);
  const fieldId = (name: string) => `${id}-${name}`;
  const currency = currencyCode ?? "none";

  return (
    <Card role="search" aria-label={t("search.label")} className="mb-3.5 p-4 sm:mb-5 sm:p-5">
      {/* Enter applies the typed fields at once instead of after the pause. */}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          apply(typed);
        }}
      >
        <TextField
          id={fieldId("q")}
          label={t("search.search")}
          type="search"
          value={typed.q}
          onChange={(event) => typeInto("q", event.target.value)}
          placeholder={t("search.searchPlaceholder")}
          maxLength={MAX_SEARCH_LENGTH}
          autoComplete="off"
          enterKeyHint="search"
        />

        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-between">
          <AccountSwitcher accounts={accounts} archivedAccounts={archivedAccounts} currentAccountId={accountId} />
          <fieldset className="min-w-0">
            <legend className="sr-only">{t("search.type")}</legend>
            <div className={`${choiceSegmentsClassName} flex-wrap sm:inline-flex`}>
              {(["", ...TRANSACTION_TYPES] as const).map((option) => (
                <label key={option} className="grow sm:grow-0">
                  <input
                    type="radio"
                    name={fieldId("type")}
                    value={option}
                    checked={shownFilters.type === option}
                    onChange={() => apply(typed, { type: option as TransactionType | "" })}
                    className="peer sr-only"
                  />
                  <span className={`${choiceSegmentClassName} sm:px-3.5`}>{t(`filters.${option || "all"}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={fieldId("more")}
            onClick={() => setMoreOpen(!moreOpen)}
            className={`${smallButtonClassName} -ms-2.5 font-semibold`}
          >
            <ChevronDown size={16} aria-hidden className={`shrink-0 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            {t("search.more")}
            {moreCount > 0 && (
              <Badge tone="info" variant="pill" className="py-0.5">
                {t("search.activeCount", { count: moreCount })}
              </Badge>
            )}
          </button>
          {canClear && (
            <button type="button" onClick={clear} className={`${smallButtonClassName} -me-2.5 text-muted-foreground hover:text-foreground`}>
              <X size={14} aria-hidden className="shrink-0" />
              {t("search.clear")}
            </button>
          )}
        </div>

        <div id={fieldId("more")} hidden={!moreOpen} className="mt-4 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            id={fieldId("from")}
            label={t("search.from")}
            type="date"
            value={typed.from}
            max={typed.to || undefined}
            onChange={(event) => typeInto("from", event.target.value)}
          />
          <TextField
            id={fieldId("to")}
            label={t("search.to")}
            type="date"
            value={typed.to}
            min={typed.from || undefined}
            onChange={(event) => typeInto("to", event.target.value)}
            error={dateRangeInvalid ? t("search.dateRangeInvalid") : undefined}
          />
          <TextField
            id={fieldId("minAmount")}
            label={t("search.minAmount", { currency })}
            type="text"
            dir="ltr"
            inputMode={minorUnit === 0 ? "numeric" : "decimal"}
            autoComplete="off"
            placeholder={(0).toFixed(minorUnit)}
            value={typed.minAmount}
            onChange={(event) => typeInto("minAmount", filterAmountInput(event.target.value))}
            error={amountError(minAmountMinor)}
          />
          <TextField
            id={fieldId("maxAmount")}
            label={t("search.maxAmount", { currency })}
            type="text"
            dir="ltr"
            inputMode={minorUnit === 0 ? "numeric" : "decimal"}
            autoComplete="off"
            placeholder={(0).toFixed(minorUnit)}
            value={typed.maxAmount}
            onChange={(event) => typeInto("maxAmount", filterAmountInput(event.target.value))}
            error={amountError(maxAmountMinor) ?? (amountRangeInvalid ? t("search.amountRangeInvalid") : undefined)}
          />
          <SelectField
            id={fieldId("category")}
            label={t("search.category")}
            required={false}
            value={shownFilters.categoryId}
            onChange={(event) => apply(typed, { categoryId: event.target.value })}
          >
            <option value="">{t("search.allCategories")}</option>
            <option value="none">{t("uncategorised")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={fieldId("sort")}
            label={t("search.sort")}
            value={shownFilters.sort}
            onChange={(event) => apply(typed, { sort: event.target.value as SortOption })}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`search.sorts.${option}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={fieldId("pageSize")}
            label={t("search.pageSize")}
            value={shownFilters.pageSize}
            onChange={(event) => apply(typed, { pageSize: Number(event.target.value) })}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </SelectField>
        </div>
      </form>
    </Card>
  );
}
