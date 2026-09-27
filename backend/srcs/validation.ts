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

/** Returns whether a value is a parseable ISO 8601 timestamp string. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Returns whether a value is a YYYY-MM-DD date string. */
export function isDateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Returns whether a value is a CSS hex color string (e.g. #2563EB). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}
