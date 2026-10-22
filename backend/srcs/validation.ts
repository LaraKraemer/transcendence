const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Returns whether a value is a CSS hex color string (e.g. #2563EB). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

/** Uses registration's character minimum and bcrypt's UTF-8 byte limit. */
export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && Buffer.byteLength(value, "utf8") <= 72;
}

/** Returns whether a value is a valid display name (1–100 chars after trim). */
export function isValidDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 100;
}

// File format signatures (magic bytes): the first bytes of a file that identify
// its format per spec, regardless of filename or Content-Type header. Using
// these prevents a malicious upload from disguising a non-image as JPEG/PNG.
// JPEG: FF D8 FF — SOI marker (FF D8) + start of first segment marker (FF).
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
// PNG: 89 50 4E 47 0D 0A 1A 0A — 0x89 catches transport corruption, "PNG"
// in ASCII, then line-ending bytes that detect bad line-ending translation.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Returns the MIME type if the buffer starts with JPEG or PNG signature bytes, otherwise null. */
export function isJpegOrPng(header: Buffer): "image/jpeg" | "image/png" | null {
  if (JPEG_SIGNATURE.every((b, i) => header[i] === b)) return "image/jpeg";
  if (PNG_SIGNATURE.every((b, i) => header[i] === b)) return "image/png";
  return null;
}

/**
 * Validates optional free text: trims it and maps blank or `null` to `null`.
 * Returns `undefined` (not a valid value) when the input is not a string or exceeds `maxLength`
 * trimmed characters (counted in UTF-16 units, like `description`). Callers handle an omitted
 * field before calling, so `undefined` input is also rejected.
 */
export function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > maxLength) return undefined;
  return text === "" ? null : text;
}
