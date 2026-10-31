"use client";

import { ChevronDown, Download, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useOptimistic, useTransition, type FormEvent, type ReactNode } from "react";

import { RANGE_PRESETS, type DateRange, type RangePreset } from "@/lib/analytics";

type Option = { id: string; name: string };
type Filters = { range: RangePreset; accountId: string; categoryId: string; type: string };

const focusRing = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const fieldClassName = `w-full rounded-[10px] border border-border bg-card py-2 text-[13px] font-medium ${focusRing}`;
const buttonClassName = `inline-flex items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3.5 py-2 text-[13px] font-semibold hover:bg-accent ${focusRing}`;

/**
 * The analytics filters. Every choice is kept in the URL (so reload and Back restore it) and applies at once;
 * custom dates apply with a button, because a date input reports each typed digit as a change.
 */
export function AnalyticsFilters({
  filters,
  customRange,
  accounts,
  archivedAccounts,
  categories,
  exportHref,
}: {
  filters: Filters;
  /** The dates the custom range form starts with. */
  customRange: DateRange;
  accounts: Option[];
  archivedAccounts: Option[];
  categories: Option[];
  /** The CSV download of the filtered transactions; null while the range is invalid. */
  exportHref: string | null;
}) {
  const t = useTranslations("analytics");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = useId();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useOptimistic(filters);

  /** Writes the changed filters to the URL; an empty value removes its parameter. */
  function update(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value === "") params.delete(name);
      else params.set(name, value);
    }
    startTransition(() => {
      setSelected((current) => ({ ...current, ...changes }));
      router.push(`${pathname}?${params}`, { scroll: false });
    });
  }

  function changeRange(range: string) {
    // A custom range starts from the dates shown so far; a preset needs none.
    update(range === "custom" ? { range, ...customRange } : { range, from: "", to: "" });
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update({ range: "custom", from: String(data.get("from")), to: String(data.get("to")) });
  }

  return (
    <section aria-label={t("filters")} className="mb-3.5 flex flex-col gap-3 sm:mb-6 print:hidden">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect id={`${id}-range`} label={t("range")} value={selected.range} onChange={changeRange}>
          {RANGE_PRESETS.map((range) => (
            <option key={range} value={range}>
              {t(`ranges.${range}`)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id={`${id}-account`}
          label={t("account")}
          value={selected.accountId}
          onChange={(accountId) => update({ accountId })}
        >
          <option value="">{t("allAccounts")}</option>
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
        </FilterSelect>
        <FilterSelect
          id={`${id}-category`}
          label={t("category")}
          value={selected.categoryId}
          onChange={(categoryId) => update({ categoryId })}
        >
          <option value="">{t("allCategories")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id={`${id}-type`} label={t("type")} value={selected.type} onChange={(type) => update({ type })}>
          <option value="">{t("allTypes")}</option>
          <option value="expense">{t("expenses")}</option>
          <option value="income">{t("income")}</option>
        </FilterSelect>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {selected.range === "custom" ? (
          <form onSubmit={applyCustomRange} className="flex flex-wrap items-end gap-3">
            {(["from", "to"] as const).map((name) => (
              <div key={name}>
                <label htmlFor={`${id}-${name}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t(name)}
                </label>
                {/* Keyed by the date, so Back shows the date of the URL again. */}
                <input
                  key={customRange[name]}
                  id={`${id}-${name}`}
                  name={name}
                  type="date"
                  required
                  defaultValue={customRange[name]}
                  className={`${fieldClassName} px-3`}
                />
              </div>
            ))}
            <button type="submit" className={buttonClassName}>
              {t("apply")}
            </button>
          </form>
        ) : (
          <span />
        )}
        {exportHref && (
          <div className="flex flex-wrap gap-2">
            {/* The API answers with a CSV attachment, so the browser downloads it instead of leaving the page. */}
            <a href={exportHref} className={buttonClassName}>
              <Download size={16} aria-hidden />
              {t("exportCsv")}
            </a>
            <button type="button" onClick={() => window.print()} className={buttonClassName}>
              <Printer size={16} aria-hidden />
              {t("exportPdf")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldClassName} cursor-pointer appearance-none truncate ps-3.5 pe-9`}
        >
          {children}
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
