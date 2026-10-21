"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { backendFailure } from "@/lib/action-errors";
import { ApiError } from "@/lib/api";
import { fetchApiServer, getAccount, getCurrencies } from "@/lib/dal";
import type { ActionResponse, Transaction } from "@/lib/types";
import {
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  TRANSACTION_TYPES,
  changedFields,
  toPositiveMinorUnits,
  type EditableTransactionFields,
  type TransactionErrorCode,
} from "@/lib/validation";

const CreateTransactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES, { error: "typeInvalid" satisfies TransactionErrorCode }),
  amount: z.string(),
  description: z
    .string()
    .trim()
    .min(1, { error: "descriptionRequired" satisfies TransactionErrorCode })
    .max(MAX_TRANSACTION_DESCRIPTION_LENGTH, { error: "descriptionTooLong" satisfies TransactionErrorCode }),
  bookedOn: z.iso.date({ error: "dateInvalid" satisfies TransactionErrorCode }),
  categoryId: z.union([z.literal(""), z.uuid()], { error: "categoryInvalid" satisfies TransactionErrorCode }),
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

  const { type, description, bookedOn, categoryId, notes } = parsed.data;
  try {
    await fetchApiServer<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify({
        accountId,
        amountMinor: type === "expense" ? -amountMinor : amountMinor,
        description,
        bookedOn,
        ...(categoryId === "" ? {} : { categoryId }),
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
