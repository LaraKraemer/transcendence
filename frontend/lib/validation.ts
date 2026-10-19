export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;
export const MAX_DISPLAY_NAME_LENGTH = 100;

export const validationErrorCodes = [
  "emailInvalid",
  "passwordRequired",
  "passwordTooShort",
  "passwordTooLong",
  "displayNameRequired",
  "displayNameTooLong",
] as const;

export type ValidationErrorCode = (typeof validationErrorCodes)[number];

export type FieldErrors<F extends string> = Partial<Record<F, ValidationErrorCode>>;

export type LoginFields = { email: string; password: string };
export type RegisterFields = LoginFields & { displayName: string };

export function isValidationErrorCode(value: unknown): value is ValidationErrorCode {
  return typeof value === "string" && (validationErrorCodes as readonly string[]).includes(value);
}

/** Password length in UTF-8 bytes — bcrypt only reads the first 72, so the backend caps it there. */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

function validateEmail(email: string): ValidationErrorCode | undefined {
  return email.includes("@") ? undefined : "emailInvalid";
}

function validatePassword(password: string): ValidationErrorCode | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return "passwordTooShort";
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) return "passwordTooLong";
  return undefined;
}

function compact<F extends string>(errors: Record<F, ValidationErrorCode | undefined>): FieldErrors<F> {
  return Object.fromEntries(Object.entries(errors).filter(([, code]) => code)) as FieldErrors<F>;
}

// Login only requires a password, not the sign-up length rule: like signIn in
// lib/actions/auth.ts, a length check here would lock out older passwords.
export function validateLogin({ email, password }: LoginFields): FieldErrors<keyof LoginFields> {
  return compact({ email: validateEmail(email), password: password ? undefined : "passwordRequired" });
}

export function validateRegister({ email, displayName, password }: RegisterFields): FieldErrors<keyof RegisterFields> {
  return compact({
    displayName: displayName.trim() ? undefined : "displayNameRequired",
    email: validateEmail(email),
    password: validatePassword(password),
  });
}

// Accounts. These mirror the backend's account rules (routes/account.ts).
export const ACCOUNT_TYPES = ["checking", "savings", "cash"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const MAX_ACCOUNT_NAME_LENGTH = 100;

export const accountErrorCodes = [
  "nameRequired",
  "nameTooLong",
  "typeInvalid",
  "currencyInvalid",
  "openingBalanceInvalid",
  "openingBalanceDecimals",
  "openingBalanceTooLarge",
] as const;

export type AccountErrorCode = (typeof accountErrorCodes)[number];

export function isAccountErrorCode(value: unknown): value is AccountErrorCode {
  return typeof value === "string" && (accountErrorCodes as readonly string[]).includes(value);
}

/**
 * Converts a typed decimal amount ("100.50", ".5", "12.") to integer minor
 * units for a currency with `minorUnit` decimals, using string digits rather
 * than float maths (so "1.005" can't round to 100). On failure it returns the
 * error code that tells the user what to fix.
 */
export function toMinorUnits(
  amount: string,
  minorUnit: number,
): number | "openingBalanceInvalid" | "openingBalanceDecimals" | "openingBalanceTooLarge" {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  const [, sign = "", whole = "", fraction = ""] = match ?? [];
  if (!match || whole.length + fraction.length === 0) return "openingBalanceInvalid";
  if (fraction.length > minorUnit) return "openingBalanceDecimals";
  const minor = Number(`${sign}${whole || "0"}${fraction.padEnd(minorUnit, "0")}`);
  return Number.isSafeInteger(minor) ? minor : "openingBalanceTooLarge";
}

/** The account fields the edit form can change. */
export type EditableAccountFields = {
  name: string;
  type: AccountType;
  institution: string | null;
  accountRef: string | null;
};

/**
 * Returns only the fields that differ from `original`: the body for
 * `PATCH /accounts/:id`. An empty optional text and `null` both mean "not set",
 * so switching between them is not a change.
 */
export function changedAccountFields(
  original: EditableAccountFields,
  next: EditableAccountFields,
): Partial<EditableAccountFields> {
  const notSetIsNull = (value: string | null) => (value === "" ? null : value);
  return Object.fromEntries(
    (Object.keys(next) as (keyof EditableAccountFields)[])
      .filter((field) => notSetIsNull(next[field]) !== notSetIsNull(original[field]))
      .map((field) => [field, next[field]]),
  );
}
