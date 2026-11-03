/**
 * The search, filters, sort and page of /transactions, kept in the URL so reload, Back and sharing work.
 * Kept free of imports with runtime code so lib/transaction-filters.check.mjs can run it with plain Node.
 */
import type { TransactionType } from "@/lib/validation";

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
// The backend's limit of `q` (TEXT_LIMITS.description), like MAX_TRANSACTION_DESCRIPTION_LENGTH.
export const MAX_SEARCH_LENGTH = 500;

const SORT_FIELDS = ["bookedOn", "amountMinor", "createdAt"] as const;
const SORT_ORDERS = ["desc", "asc"] as const;
export const SORT_OPTIONS = SORT_FIELDS.flatMap((field) => SORT_ORDERS.map((order) => `${field}:${order}` as const));
export type SortOption = (typeof SORT_OPTIONS)[number];

/** An empty string means "not set". `categoryId` is a category id or "none" (uncategorised). */
export type TransactionFilters = {
  q: string;
  type: TransactionType | "";
  categoryId: string;
  from: string;
  to: string;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  sort: SortOption;
  pageSize: number;
  page: number;
};

export const DEFAULT_FILTERS: TransactionFilters = {
  q: "",
  type: "",
  categoryId: "",
  from: "",
  to: "",
  minAmountMinor: null,
  maxAmountMinor: null,
  sort: "bookedOn:desc",
  pageSize: DEFAULT_PAGE_SIZE,
  page: 1,
};

type SearchParams = { [key: string]: string | string[] | undefined };

/** A repeated param counts as missing. */
const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** A `YYYY-MM-DD` date that exists, like the backend's isDateOnly. */
function isDateOnly(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nonNegativeInteger(value: string): number | null {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

/**
 * Reads the filters from the page's search params. Anything the backend would reject (an unknown
 * category, a malformed date or amount) counts as not set, so a hand-edited URL still shows a page.
 */
export function parseTransactionFilters(params: SearchParams, categoryIds: readonly string[]): TransactionFilters {
  const type = single(params.type);
  const categoryId = single(params.categoryId);
  const from = single(params.from);
  const to = single(params.to);
  const minAmountMinor = nonNegativeInteger(single(params.minAmountMinor));
  const maxAmountMinor = nonNegativeInteger(single(params.maxAmountMinor));
  const sort = `${single(params.sort) || "bookedOn"}:${single(params.order) || "desc"}`;
  const pageSize = PAGE_SIZES.find((size) => String(size) === single(params.pageSize)) ?? DEFAULT_PAGE_SIZE;
  const page = nonNegativeInteger(single(params.page)) ?? 1;
  return {
    q: single(params.q).trim().slice(0, MAX_SEARCH_LENGTH),
    type: type === "expense" || type === "income" || type === "transfer" ? type : "",
    categoryId: categoryId === "none" || categoryIds.includes(categoryId) ? categoryId : "",
    from: isDateOnly(from) ? from : "",
    to: isDateOnly(to) ? to : "",
    minAmountMinor,
    // The backend rejects a range whose minimum is above its maximum.
    maxAmountMinor: minAmountMinor !== null && maxAmountMinor !== null && maxAmountMinor < minAmountMinor ? null : maxAmountMinor,
    sort: SORT_OPTIONS.find((option) => option === sort) ?? DEFAULT_FILTERS.sort,
    pageSize,
    // At least 1, and small enough that its offset is a safe integer.
    page: page >= 1 && Number.isSafeInteger((page - 1) * pageSize) ? page : 1,
  };
}

/** The URL search params of `filters` on one account (or all), leaving out the defaults. */
export function transactionsSearchParams(filters: TransactionFilters, accountId?: string): URLSearchParams {
  const [sort, order] = filters.sort.split(":");
  const [defaultSort, defaultOrder] = DEFAULT_FILTERS.sort.split(":");
  return new URLSearchParams({
    ...(accountId === undefined ? {} : { accountId }),
    ...(filters.q === "" ? {} : { q: filters.q }),
    ...(filters.type === "" ? {} : { type: filters.type }),
    ...(filters.categoryId === "" ? {} : { categoryId: filters.categoryId }),
    ...(filters.from === "" ? {} : { from: filters.from }),
    ...(filters.to === "" ? {} : { to: filters.to }),
    ...(filters.minAmountMinor === null ? {} : { minAmountMinor: String(filters.minAmountMinor) }),
    ...(filters.maxAmountMinor === null ? {} : { maxAmountMinor: String(filters.maxAmountMinor) }),
    ...(sort === defaultSort ? {} : { sort }),
    ...(order === defaultOrder ? {} : { order }),
    ...(filters.pageSize === DEFAULT_PAGE_SIZE ? {} : { pageSize: String(filters.pageSize) }),
    ...(filters.page === 1 ? {} : { page: String(filters.page) }),
  });
}

export function transactionsHref(filters: TransactionFilters, accountId?: string): string {
  const query = transactionsSearchParams(filters, accountId).toString();
  return query ? `/transactions?${query}` : "/transactions";
}

/** The `GET /transactions` query: the same filters, with the page as limit and offset. */
export function transactionsApiQuery(filters: TransactionFilters, accountId: string | undefined, offset: number): string {
  const query = transactionsSearchParams({ ...filters, pageSize: DEFAULT_PAGE_SIZE, page: 1 }, accountId);
  query.set("limit", String(filters.pageSize));
  query.set("offset", String(offset));
  return query.toString();
}

/** Whether a filter narrows the list (sort and page size only reorder or split it). */
export function isFiltered(filters: TransactionFilters): boolean {
  return (["q", "type", "categoryId", "from", "to", "minAmountMinor", "maxAmountMinor"] as const).some(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  );
}

/**
 * The page links to show: the first, the last and the current one with its neighbours. `null` is a gap
 * of more than one page; a gap of exactly one shows that page instead.
 */
export function pageNumbers(current: number, count: number): (number | null)[] {
  const shown = [...new Set([1, current - 1, current, current + 1, count])]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b);
  return shown.flatMap((page, index) => {
    const previous = shown[index - 1];
    if (previous === undefined || page - previous === 1) return [page];
    return page - previous === 2 ? [previous + 1, page] : [null, page];
  });
}
