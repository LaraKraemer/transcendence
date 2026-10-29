/**
 * Shared frontend types.
 *
 * Single source of truth for the authenticated user and the shape returned by
 * the auth server actions. Imported by the API client, the DAL, the server
 * actions, and the auth context.
 */
import type { AccountType, CategoryType, TransactionType } from "@/lib/validation";

/** The authenticated user, as exposed to the UI (a safe subset of the backend row). */
export type User = {
  id: string;
  email: string;
  displayName: string;
  /** API path of the profile photo (`/auth/me/avatar?v=…`, the `v` changes with each new photo), or null when there is none. */
  avatarUrl: string | null;
};

/**
 * Standard result returned by the auth server actions.
 *
 * - `success` — whether the action completed.
 * - `message` — human-readable summary for the UI.
 * - `errors` — per-field validation messages, keyed by field name (from Zod).
 * - `user` — the authenticated user on a successful login/register.
 * - `status` — the backend's HTTP status when it rejected the request, so the UI
 *   can tell e.g. "email taken" (409) from "wrong credentials" (401).
 */
export type ActionResponse = {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
  user?: User;
  status?: number;
};

/** A financial account, as returned by the backend's /accounts endpoints. */
export type Account = {
  id: string;
  name: string;
  type: AccountType;
  currencyCode: string;
  openingBalanceMinor: number;
  institution: string | null;
  accountRef: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Response body of `GET /accounts/:id/balance`. */
export type AccountBalance = {
  balanceMinor: number;
  currencyCode: string;
};

/**
 * A transaction, as returned by the backend's /transactions endpoints. Its `type` decides the sign
 * of `amountMinor`: expense negative, income positive, transfer either (never 0). The two legs of a
 * transfer share a `transferGroupId`. `bookedOn` is a `YYYY-MM-DD` date.
 */
export type Transaction = {
  id: string;
  accountId: string;
  categoryId: string | null;
  createdById: string;
  type: TransactionType;
  transferGroupId: string | null;
  /** List responses only: the account and amount of the transfer's other leg (null when that leg was deleted). */
  transferAccountId?: string | null;
  transferAmountMinor?: number | null;
  amountMinor: number;
  description: string | null;
  merchant: string | null;
  notes: string | null;
  bookedOn: string;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Response body of `GET /transactions`: one page, newest first, plus the number of matches. Without
 * `accountId` a transfer is one item: its source leg, with `transferAccountId` and `transferAmountMinor`.
 */
export type TransactionPage = {
  items: Transaction[];
  total: number;
};

/** One row of `GET /transactions/summary`: the signed total and count per (category, type); null = uncategorised. */
export type TransactionSummaryRow = {
  categoryId: string | null;
  type: TransactionType;
  totalMinor: number;
  count: number;
};

/**
 * A category, as returned by the backend's /categories endpoints. `types` are the transaction types
 * it can be used for (transfers have no category).
 */
export type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
  types: CategoryType[];
  createdAt: string;
};

/** Currency reference data from `GET /currencies`. `minorUnit` is the number of decimals (2 for all catalogue currencies). */
export type Currency = {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
};
