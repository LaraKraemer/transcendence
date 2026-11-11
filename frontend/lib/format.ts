/**
 * Formats integer minor units for display: `formatAmount(1250, "EUR", 2, "en")` → "€12.50".
 * `minorUnit` is the currency's decimal count (JPY 0, KWD 3, most 2). It fixes the shown
 * decimals too, so our reference data wins over Intl's built-in table. `locale` decides
 * separators and symbol placement (e.g. "de" → "12,50 €").
 */
export function formatAmount(
  amountMinor: number,
  currencyCode: string,
  minorUnit: number,
  locale: string,
  signDisplay: Intl.NumberFormatOptions["signDisplay"] = "auto",
): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Monetary amount exceeds the safe integer range");
  const decimal = `${amountMinor}e${-minorUnit}` as Intl.StringNumericLiteral;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    signDisplay,
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  }).format(decimal);
}

/** Adds minor units exactly, including cancellation, or rejects an unrepresentable result. */
export function sumMinorUnits(amounts: number[]): number {
  let total = BigInt(0);
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount)) throw new RangeError("Monetary amount exceeds the safe integer range");
    total += BigInt(amount);
  }
  const result = Number(total);
  if (!Number.isSafeInteger(result)) throw new RangeError("Monetary total exceeds the safe integer range");
  return result;
}

/** A readable transaction name, including when optional details are absent. */
export function transactionLabel(
  transaction: { description: string | null; merchant: string | null },
  categoryName: string | undefined,
  typeLabel: string,
): string {
  return transaction.description || transaction.merchant || categoryName || typeLabel;
}
