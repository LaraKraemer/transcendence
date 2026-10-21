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
  "amountInvalid",
  "amountDecimals",
  "amountTooLarge",
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
): number | "amountInvalid" | "amountDecimals" | "amountTooLarge" {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  const [, sign = "", whole = "", fraction = ""] = match ?? [];
  if (!match || whole.length + fraction.length === 0) return "amountInvalid";
  if (fraction.length > minorUnit) return "amountDecimals";
  const minor = Number(`${sign}${whole || "0"}${fraction.padEnd(minorUnit, "0")}`);
  return Number.isSafeInteger(minor) ? minor : "amountTooLarge";
}

// Transactions. These mirror the backend's transaction rules (routes/transaction.ts).
// The form asks for a positive amount plus a type; the type decides the sign.
export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export const MAX_TRANSACTION_DESCRIPTION_LENGTH = 500;

export const transactionErrorCodes = [
  "typeInvalid",
  "amountRequired",
  "amountNotPositive",
  "amountInvalid",
  "amountDecimals",
  "amountTooLarge",
  "descriptionRequired",
  "descriptionTooLong",
  "dateInvalid",
  "categoryInvalid",
  "toAccountInvalid",
] as const;

export type TransactionErrorCode = (typeof transactionErrorCodes)[number];

export function isTransactionErrorCode(value: unknown): value is TransactionErrorCode {
  return typeof value === "string" && (transactionErrorCodes as readonly string[]).includes(value);
}

/**
 * Converts a typed amount to positive minor units. The backend rejects 0, and
 * the sign comes from the expense/income type, so zero and a typed minus are errors.
 */
export function toPositiveMinorUnits(
  amount: string,
  minorUnit: number,
): number | "amountRequired" | "amountNotPositive" | "amountInvalid" | "amountDecimals" | "amountTooLarge" {
  const trimmed = amount.trim();
  if (trimmed === "") return "amountRequired";
  if (trimmed.startsWith("-")) return "amountNotPositive";
  const minor = toMinorUnits(trimmed, minorUnit);
  if (typeof minor === "string") return minor;
  return minor === 0 ? "amountNotPositive" : minor;
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

// Categories. These mirror the backend's category rules (routes/category.ts).
// The types a user can give a category, which are also the types of a regular (non-transfer)
// transaction. The system "Transfer" category is the only one with the "transfer" type.
export const CATEGORY_TYPES = ["expense", "income"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];
export const MAX_CATEGORY_NAME_LENGTH = 80;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const categoryErrorCodes = [
  "nameRequired",
  "nameTooLong",
  "nameTaken",
  "iconInvalid",
  "colorInvalid",
  "typesInvalid",
] as const;

export type CategoryErrorCode = (typeof categoryErrorCodes)[number];

export function isCategoryErrorCode(value: unknown): value is CategoryErrorCode {
  return typeof value === "string" && (categoryErrorCodes as readonly string[]).includes(value);
}

const LIGHT_ON_COLOR = "#FFFFFF";
// Pure black, not --foreground: only white/black guarantees 4.5:1 for every colour (worst case 4.58:1).
const DARK_ON_COLOR = "#000000";

/** WCAG relative luminance of a #RRGGBB colour. */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * White or black text/icons for a surface filled with `hex`, whichever contrasts
 * more. For any colour one of the two reaches at least 4.58:1, so a category
 * tile stays readable whatever colour the user picks, in both themes.
 */
export function readableOn(hex: string): typeof LIGHT_ON_COLOR | typeof DARK_ON_COLOR {
  return contrastRatio(hex, LIGHT_ON_COLOR) >= contrastRatio(hex, DARK_ON_COLOR) ? LIGHT_ON_COLOR : DARK_ON_COLOR;
}
