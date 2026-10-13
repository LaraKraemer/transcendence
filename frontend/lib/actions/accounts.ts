"use server";

/**
 * Account server actions. Like lib/actions/auth.ts, they validate with Zod and
 * return AccountErrorCodes (see lib/validation.ts) instead of sentences, so the
 * form can show them in the user's language.
 */
import { refresh } from "next/cache";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { fetchApiServer, getCurrencies } from "@/lib/dal";
import type { Account, ActionResponse } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  MAX_ACCOUNT_NAME_LENGTH,
  toMinorUnits,
  type AccountErrorCode,
} from "@/lib/validation";

const CreateAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "nameRequired" satisfies AccountErrorCode })
    .max(MAX_ACCOUNT_NAME_LENGTH, { error: "nameTooLong" satisfies AccountErrorCode }),
  type: z.enum(ACCOUNT_TYPES, { error: "typeInvalid" satisfies AccountErrorCode }),
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
      input.openingBalance && currency ? toMinorUnits(input.openingBalance, currency.minorUnit) : 0;
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
    if (error instanceof ApiError) return { success: false, message: error.message, status: error.status };
    // No status: the request never reached the backend (see formErrorFor in components/auth/form-parts.tsx).
    console.error("createAccount: request failed:", error);
    return { success: false, message: "Could not reach the server. Please try again later." };
  }

  refresh();
  return { success: true, message: "Account created" };
}
