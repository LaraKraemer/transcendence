import type { NewTransaction } from "./db/schema.ts";
import { isCurrencyCode, parseEntryFields, parseOptionalText, signError, TEXT_LIMITS } from "./validation.ts";

export const TRANSACTION_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSACTION_IMPORT_MAX_ROWS = 1000;

type ImportEntry = Pick<
  NewTransaction,
  "type" | "amountMinor" | "bookedOn" | "description" | "notes" | "occurredAt"
> & {
  category?: string | null;
};
export type TransactionImport = { currency: string; transactions: ImportEntry[] };

/** Validates the versioned document without accepting client IDs or ownership fields. */
export function parseTransactionImport(value: unknown): TransactionImport | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "Import must be a JSON object" };
  }
  const document = value as Record<string, unknown>;
  if (Object.keys(document).some((key) => !["version", "currency", "transactions"].includes(key))) {
    return { error: "Import contains unsupported fields" };
  }
  if (document.version !== 1) return { error: "Import version must be 1" };
  if (!isCurrencyCode(document.currency)) return { error: "currency must be three uppercase letters" };
  if (
    !Array.isArray(document.transactions) ||
    document.transactions.length < 1 ||
    document.transactions.length > TRANSACTION_IMPORT_MAX_ROWS
  ) {
    return { error: `Import must contain 1–${TRANSACTION_IMPORT_MAX_ROWS} transactions` };
  }
  const entries: ImportEntry[] = [];
  for (const [index, value] of document.transactions.entries()) {
    const rowError = (error: string) => ({ error: `Row ${index + 1}: ${error}` });
    if (typeof value !== "object" || value === null || Array.isArray(value)) return rowError("must be an object");
    const entry = value as Record<string, unknown>;
    if (
      Object.keys(entry).some(
        (key) => !["type", "amountMinor", "bookedOn", "description", "notes", "occurredAt", "category"].includes(key),
      )
    ) {
      return rowError("contains unsupported fields");
    }
    if (entry.type !== "expense" && entry.type !== "income")
      return rowError("type must be expense or income; transfers are not supported");
    if (typeof entry.amountMinor !== "number" || !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0)
      return rowError("amountMinor must be a non-zero safe integer");
    const amountError = signError(entry.type, entry.amountMinor);
    if (amountError) return rowError(amountError);
    const fields = parseEntryFields(entry);
    if ("error" in fields) return rowError(fields.error);
    const category = parseOptionalText(entry.category ?? null, TEXT_LIMITS.categoryName);
    if (category === undefined)
      return rowError(`category must be a string of at most ${TEXT_LIMITS.categoryName} characters or null`);
    entries.push({
      ...(entry.category === undefined ? {} : { category }),
      type: entry.type,
      amountMinor: entry.amountMinor,
      bookedOn: entry.bookedOn as string,
      description: fields.description,
      notes: fields.notes,
      occurredAt: typeof entry.occurredAt === "string" ? new Date(entry.occurredAt) : null,
    });
  }
  return { currency: document.currency, transactions: entries };
}
