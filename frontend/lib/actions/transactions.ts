"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { fetchApiServer } from "@/lib/dal";
import type { ActionResponse } from "@/lib/types";

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
