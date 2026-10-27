/**
 * Pure helpers for the transactions page. Kept free of imports with runtime code so
 * lib/transactions.check.mjs can run it with plain Node.
 */
import type { Transaction } from "@/lib/types";

/** One row of a transaction list: a transaction, or a transfer with both legs (`transaction` is the source leg). */
export type TransactionRow = { transaction: Transaction; transferTo?: Transaction };

/**
 * Turns the two legs of each transfer into one row at the position of the first leg, keeping the list
 * order. A leg whose other leg is not in `items` (its account was deleted, or it is on the next page)
 * stays a row on its own.
 */
export function groupTransferLegs(items: Transaction[]): TransactionRow[] {
  const legsByGroup = new Map<string, Transaction[]>();
  for (const tx of items) {
    if (tx.transferGroupId !== null) legsByGroup.set(tx.transferGroupId, [...(legsByGroup.get(tx.transferGroupId) ?? []), tx]);
  }

  const groupedIds = new Set<string>();
  const rows: TransactionRow[] = [];
  for (const tx of items) {
    const legs = tx.transferGroupId === null ? undefined : legsByGroup.get(tx.transferGroupId);
    const [first, second] = legs ?? [];
    if (legs?.length !== 2 || !first || !second) {
      rows.push({ transaction: tx });
    } else if (!groupedIds.has(first.id)) {
      groupedIds.add(first.id);
      rows.push(first.amountMinor < 0 ? { transaction: first, transferTo: second } : { transaction: second, transferTo: first });
    }
  }
  return rows;
}
