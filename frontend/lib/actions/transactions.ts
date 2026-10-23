"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { backendFailure } from "@/lib/action-errors";
import { ApiError } from "@/lib/api";
import { fetchApiServer, getAccount, getCurrencies } from "@/lib/dal";
import type { ActionResponse, Transaction } from "@/lib/types";
import {
  CATEGORY_TYPES,
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  MAX_TRANSACTION_MERCHANT_LENGTH,
  changedFields,
  toPositiveMinorUnits,
  type EditableTransactionFields,
  type TransactionErrorCode,
} from "@/lib/validation";

const CreateTransactionSchema = z.object({
  // Transfers go through createTransfer, so this accepts only the types a category can have.
  type: z.enum(CATEGORY_TYPES, { error: "typeInvalid" satisfies TransactionErrorCode }),
  amount: z.string(),
  description: z
    .string()
    .trim()
    .min(1, { error: "descriptionRequired" satisfies TransactionErrorCode })
    .max(MAX_TRANSACTION_DESCRIPTION_LENGTH, { error: "descriptionTooLong" satisfies TransactionErrorCode }),
  bookedOn: z.iso.date({ error: "dateInvalid" satisfies TransactionErrorCode }),
  categoryId: z.union([z.literal(""), z.uuid()], { error: "categoryInvalid" satisfies TransactionErrorCode }),
  merchant: z
    .string()
    .trim()
    .max(MAX_TRANSACTION_MERCHANT_LENGTH, { error: "merchantTooLong" satisfies TransactionErrorCode }),
  notes: z.string().trim(),
});

export type CreateTransactionInput = Record<keyof z.input<typeof CreateTransactionSchema>, string>;

export async function createTransaction(accountId: string, data: CreateTransactionInput): Promise<ActionResponse> {
  if (!z.uuid().safeParse(accountId).success) {
    return { success: false, message: "Account not found", status: 404 };
  }
  const parsed = CreateTransactionSchema.safeParse({
    type: String(data.type),
    amount: String(data.amount),
    description: String(data.description),
    bookedOn: String(data.bookedOn),
    categoryId: String(data.categoryId),
    merchant: String(data.merchant),
    notes: String(data.notes),
  });
  const errors: Record<string, string[]> = parsed.success
    ? {}
    : (z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);

  let amountMinor: number;
  try {
    const [account, currencies] = await Promise.all([getAccount(accountId), getCurrencies()]);
    const minorUnit = currencies.find((c) => c.code === account.currencyCode)?.minorUnit ?? 2;
    const amount = toPositiveMinorUnits(String(data.amount), minorUnit);
    if (typeof amount === "string") errors.amount = [amount];
    if (!parsed.success || typeof amount === "string") return { success: false, message: "Validation failed", errors };
    amountMinor = amount;
  } catch (error) {
    return backendFailure(error, "createTransaction");
  }

  const { type, description, bookedOn, categoryId, merchant, notes } = parsed.data;
  try {
    await fetchApiServer<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify({
        accountId,
        type,
        amountMinor: type === "expense" ? -amountMinor : amountMinor,
        description,
        bookedOn,
        ...(categoryId === "" ? {} : { categoryId }),
        ...(merchant === "" ? {} : { merchant }),
        ...(notes === "" ? {} : { notes }),
      }),
    });
  } catch (error) {
    return transactionFailure(error, categoryId !== "", "createTransaction");
  }

  refresh();
  return { success: true, message: "Transaction created" };
}

const UpdateTransactionSchema = CreateTransactionSchema.pick({ description: true, bookedOn: true }).extend({
  categoryId: CreateTransactionSchema.shape.categoryId.transform((value) => value || null),
  notes: CreateTransactionSchema.shape.notes.transform((value) => value || null),
  merchant: CreateTransactionSchema.shape.merchant.transform((value) => value || null),
});

export type UpdateTransactionInput = Record<keyof z.input<typeof UpdateTransactionSchema>, string>;

export async function updateTransaction(
  transactionId: string,
  opened: EditableTransactionFields,
  data: UpdateTransactionInput,
): Promise<ActionResponse> {
  if (!z.uuid().safeParse(transactionId).success) {
    return { success: false, message: "Transaction not found", status: 404 };
  }
  const parsed = UpdateTransactionSchema.safeParse({
    description: String(data.description),
    merchant: String(data.merchant),
    bookedOn: String(data.bookedOn),
    categoryId: String(data.categoryId),
    notes: String(data.notes),
  });
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const updates = changedFields(opened, parsed.data);
  if (Object.keys(updates).length === 0) return { success: true, message: "No changes" };

  try {
    await fetchApiServer<Transaction>(`/transactions/${transactionId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  } catch (error) {
    return transactionFailure(error, typeof updates.categoryId === "string", "updateTransaction");
  }

  refresh();
  return { success: true, message: "Transaction updated" };
}

function transactionFailure(error: unknown, sentCategory: boolean, action: string): ActionResponse {
  if (error instanceof ApiError && error.status === 400 && /^merchant/.test(error.message)) {
    return {
      success: false,
      message: error.message,
      status: error.status,
      errors: { merchant: ["merchantTooLong"] },
    };
  }
  if (error instanceof ApiError && sentCategory && /category/i.test(error.message)) {
    return {
      success: false,
      message: error.message,
      status: error.status,
      errors: { categoryId: ["categoryInvalid"] },
    };
  }
  return backendFailure(error, action);
}

const CreateTransferSchema = z.object({
  toAccountId: z.uuid({ error: "toAccountInvalid" satisfies TransactionErrorCode }),
  description: CreateTransactionSchema.shape.description,
  bookedOn: CreateTransactionSchema.shape.bookedOn,
  notes: CreateTransactionSchema.shape.notes,
});

export type CreateTransferInput = Record<"amount" | "toAmount" | keyof z.input<typeof CreateTransferSchema>, string>;

/**
 * Moves money between two of the user's accounts with `POST /transactions/transfers`. `toAmount` is
 * the amount received and only counts when the accounts have different currencies; within one
 * currency the same amount arrives. Errors are keyed like the create form's fields.
 */
export async function createTransfer(fromAccountId: string, data: CreateTransferInput): Promise<ActionResponse> {
  if (!z.uuid().safeParse(fromAccountId).success) {
    return { success: false, message: "Account not found", status: 404 };
  }
  const parsed = CreateTransferSchema.safeParse({
    toAccountId: String(data.toAccountId),
    description: String(data.description),
    bookedOn: String(data.bookedOn),
    notes: String(data.notes),
  });
  const errors: Record<string, string[]> = parsed.success
    ? {}
    : (z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  if (String(data.toAccountId) === fromAccountId) errors.toAccountId = ["toAccountInvalid"];

  let fromAmountMinor: number;
  let toAmountMinor: number;
  try {
    // An unknown destination id is also an error next to the destination field, not a failed request.
    const [fromAccount, toAccount, currencies] = await Promise.all([
      getAccount(fromAccountId),
      parsed.success ? getAccount(parsed.data.toAccountId).catch(() => null) : null,
      getCurrencies(),
    ]);
    if (parsed.success && !toAccount) errors.toAccountId = ["toAccountInvalid"];
    const minorUnitOf = (currencyCode: string) => currencies.find((c) => c.code === currencyCode)?.minorUnit ?? 2;
    const fromAmount = toPositiveMinorUnits(String(data.amount), minorUnitOf(fromAccount.currencyCode));
    if (typeof fromAmount === "string") errors.amount = [fromAmount];
    const sameCurrency = !toAccount || toAccount.currencyCode === fromAccount.currencyCode;
    const toAmount = sameCurrency
      ? fromAmount
      : toPositiveMinorUnits(String(data.toAmount), minorUnitOf(toAccount.currencyCode));
    if (typeof toAmount === "string" && !sameCurrency) errors.toAmount = [toAmount];
    if (
      !parsed.success ||
      Object.keys(errors).length > 0 ||
      typeof fromAmount === "string" ||
      typeof toAmount === "string"
    ) {
      return { success: false, message: "Validation failed", errors };
    }
    fromAmountMinor = fromAmount;
    toAmountMinor = toAmount;
  } catch (error) {
    return backendFailure(error, "createTransfer");
  }

  const { toAccountId, description, bookedOn, notes } = parsed.data;
  try {
    await fetchApiServer("/transactions/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromAccountId,
        toAccountId,
        fromAmountMinor,
        toAmountMinor,
        description,
        bookedOn,
        ...(notes === "" ? {} : { notes }),
      }),
    });
  } catch (error) {
    return backendFailure(error, "createTransfer");
  }

  refresh();
  return { success: true, message: "Transfer created" };
}

export async function deleteTransaction(transactionId: string): Promise<ActionResponse> {
  if (!z.uuid().safeParse(transactionId).success) {
    return { success: false, message: "Invalid transaction id", status: 400 };
  }

  try {
    await fetchApiServer<void>(`/transactions/${transactionId}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error("deleteTransaction: request failed:", error);
      return { success: false, message: "Could not reach the server. Please try again later." };
    }
    if (error.status !== 404) return { success: false, message: error.message, status: error.status };
  }

  refresh();
  return { success: true, message: "Transaction deleted" };
}
