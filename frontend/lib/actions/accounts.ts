"use server";

/**
 * Account server actions. Like lib/actions/auth.ts, they validate with Zod and
 * return AccountErrorCodes (see lib/validation.ts) instead of sentences, so the
 * form can show them in the user's language.
 */
import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { backendFailure } from "@/lib/action-errors";
import { fetchApiServer, getCurrencies } from "@/lib/dal";
import type { Account, ActionResponse } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  MAX_ACCOUNT_NAME_LENGTH,
  changedFields,
  toMinorUnits,
  type AccountErrorCode,
  type EditableAccountFields,
} from "@/lib/validation";

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "nameRequired" satisfies AccountErrorCode })
  .max(MAX_ACCOUNT_NAME_LENGTH, { error: "nameTooLong" satisfies AccountErrorCode });
const typeSchema = z.enum(ACCOUNT_TYPES, { error: "typeInvalid" satisfies AccountErrorCode });
// Optional free text: trimmed, and empty means "not set" (null clears it in the backend).
const optionalTextSchema = z
  .string()
  .trim()
  .transform((value) => value || null);
const accountIdSchema = z.uuid();

const CreateAccountSchema = z.object({
  name: nameSchema,
  type: typeSchema,
  // Normalised before parsing (see createAccount) and checked against the
  // currency catalogue there, because the allowed decimals depend on it.
  currencyCode: z.string(),
  // A decimal amount as typed ("100.50"), or empty for no opening balance.
  openingBalance: z.string(),
});

// Raw form values: everything arrives as a string and is checked here.
export type CreateAccountInput = Record<keyof z.input<typeof CreateAccountSchema>, string>;

/** Validates input, creates the account via `POST /accounts`, and refreshes the page's data. */
export async function createAccount(data: CreateAccountInput): Promise<ActionResponse> {
  // Normalise once; everything below reads from `input`.
  const input = {
    name: String(data.name),
    type: String(data.type),
    currencyCode: String(data.currencyCode).trim().toUpperCase(),
    openingBalance: String(data.openingBalance).trim(),
  };
  const parsed = CreateAccountSchema.safeParse(input);
  const errors: Record<string, string[]> = parsed.success
    ? {}
    : (z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);

  // Everything that talks to the backend sits in one try, so a failing
  // /currencies is reported like a failing POST (network vs. HTTP status).
  try {
    const currency = (await getCurrencies()).find((c) => c.code === input.currencyCode);
    if (!currency) errors.currencyCode = ["currencyInvalid" satisfies AccountErrorCode];

    const openingBalanceMinor =
      input.openingBalance && currency ? toMinorUnits(input.openingBalance, currency.minorUnit, await getLocale()) : 0;
    if (typeof openingBalanceMinor === "string") errors.openingBalance = [openingBalanceMinor];

    if (!parsed.success || Object.keys(errors).length > 0) {
      return { success: false, message: "Validation failed", errors };
    }

    const { name, type } = parsed.data;
    await fetchApiServer<Account>("/accounts", {
      method: "POST",
      body: JSON.stringify({ name, type, currencyCode: input.currencyCode, openingBalanceMinor }),
    });
  } catch (error) {
    return backendFailure(error, "createAccount");
  }

  refresh();
  return { success: true, message: "Account created" };
}

const UpdateAccountSchema = z.object({
  name: nameSchema,
  type: typeSchema,
  institution: optionalTextSchema,
  accountRef: optionalTextSchema,
});

export type UpdateAccountInput = Record<keyof z.input<typeof UpdateAccountSchema>, string>;

/**
 * Validates the edit form and sends only the fields the user changed with
 * `PATCH /accounts/:id`, by comparing against the values the form was opened
 * with. A field the user didn't touch is never sent, so it can't overwrite a
 * change made elsewhere in the meantime.
 */
export async function updateAccount(
  accountId: string,
  opened: EditableAccountFields,
  data: UpdateAccountInput,
): Promise<ActionResponse> {
  if (!accountIdSchema.safeParse(accountId).success) {
    return { success: false, message: "Account not found", status: 404 };
  }
  const parsed = UpdateAccountSchema.safeParse({
    name: String(data.name),
    type: String(data.type),
    institution: String(data.institution),
    accountRef: String(data.accountRef),
  });
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  // `opened` only decides which fields to send; every value sent comes from the validated input.
  const updates = changedFields(opened, parsed.data);
  // Nothing changed: the backend would reject an empty PATCH, and there is nothing to save or reload.
  if (Object.keys(updates).length === 0) return { success: true, message: "No changes" };

  try {
    await fetchApiServer<Account>(`/accounts/${accountId}`, { method: "PATCH", body: JSON.stringify(updates) });
  } catch (error) {
    return backendFailure(error, "updateAccount");
  }

  refresh();
  return { success: true, message: "Account updated" };
}

/**
 * Archives an account with `PATCH { isArchived: true }`. Not `DELETE`: that
 * route is reserved for permanently deleting an account and its transactions
 * (issue #48). Archived accounts drop out of the list; transactions are kept.
 */
export async function archiveAccount(accountId: string): Promise<ActionResponse> {
  if (!accountIdSchema.safeParse(accountId).success) {
    return { success: false, message: "Account not found", status: 404 };
  }
  try {
    await fetchApiServer<Account>(`/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ isArchived: true }),
    });
  } catch (error) {
    return backendFailure(error, "archiveAccount");
  }

  refresh();
  return { success: true, message: "Account archived" };
}
