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
  // ponytail: float division is exact enough for realistic amounts (≪ 2^53 minor units);
  // switch to formatting a decimal string if huge values ever matter.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    signDisplay,
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  }).format(amountMinor / 10 ** minorUnit);
}
