"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { backendFailure } from "@/lib/action-errors";
import { fetchApiServer } from "@/lib/dal";
import { TRANSACTION_IMPORT_MAX_BYTES } from "@/lib/transaction-import";
import type { ActionResponse } from "@/lib/types";

/** Forwards the original bounded document; the backend revalidates and atomically inserts it. */
export async function importTransactions(formData: FormData): Promise<ActionResponse & { imported?: number }> {
  const accountId = formData.get("accountId");
  const file = formData.get("file");
  if (!z.uuid().safeParse(accountId).success || !(file instanceof File)) {
    return { success: false, message: "Invalid account or file", status: 400 };
  }
  if (file.size > TRANSACTION_IMPORT_MAX_BYTES) {
    return { success: false, message: "File exceeds 5 MiB", status: 413 };
  }
  let imported: number;
  try {
    const result = await fetchApiServer<{ imported: number }>(
      `/transactions/import?accountId=${encodeURIComponent(String(accountId))}`,
      {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/json" },
      },
    );
    imported = result.imported;
  } catch (error) {
    return backendFailure(error, "importTransactions");
  }
  refresh();
  return { success: true, message: "Transactions imported", imported };
}
