const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Returns whether a value is a valid UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Returns whether a value has the three-uppercase-letter ISO 4217 format. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_CODE_PATTERN.test(value);
}
