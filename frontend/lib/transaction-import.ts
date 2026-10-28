export const TRANSACTION_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSACTION_IMPORT_MAX_ROWS = 1000;

export type ImportDocument = {
  version: 1;
  currency: string;
  transactions: {
    type: "expense" | "income";
    amountMinor: number;
    bookedOn: string;
    category?: string | null;
    description?: string | null;
    notes?: string | null;
    occurredAt?: string | null;
  }[];
};

/** Checks the structure needed for a safe preview; the backend validates every domain rule on confirmation. */
export function parseImportPreview(text: string): ImportDocument | { error: "invalid"; row?: number } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "invalid" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "invalid" };
  const document = value as Record<string, unknown>;
  if (
    document.version !== 1 ||
    typeof document.currency !== "string" ||
    !/^[A-Z]{3}$/.test(document.currency) ||
    Object.keys(document).some((key) => !["version", "currency", "transactions"].includes(key)) ||
    !Array.isArray(document.transactions) ||
    document.transactions.length < 1 ||
    document.transactions.length > TRANSACTION_IMPORT_MAX_ROWS
  ) {
    return { error: "invalid" };
  }
  for (const [index, value] of document.transactions.entries()) {
    const invalid = { error: "invalid" as const, row: index + 1 };
    if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid;
    const entry = value as Record<string, unknown>;
    if (
      (entry.type !== "expense" && entry.type !== "income") ||
      typeof entry.amountMinor !== "number" ||
      !Number.isSafeInteger(entry.amountMinor) ||
      entry.amountMinor === 0 ||
      typeof entry.bookedOn !== "string" ||
      Object.keys(entry).some(
        (key) => !["type", "amountMinor", "bookedOn", "description", "notes", "occurredAt", "category"].includes(key),
      ) ||
      [entry.description, entry.notes, entry.occurredAt, entry.category].some(
        (field) => field !== undefined && field !== null && typeof field !== "string",
      )
    )
      return invalid;
  }
  return value as ImportDocument;
}
