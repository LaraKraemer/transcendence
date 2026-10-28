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
export const MAX_INSTITUTION_LENGTH = 100;
export const MAX_ACCOUNT_REF_LENGTH = 50;

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

/** Formats an edit value exactly; transactions use magnitude, opening balances preserve the sign. */
export function amountInputValue(amountMinor: number, minorUnit: number, allowNegative = false): string {
  const digits = Math.abs(amountMinor)
    .toString()
    .padStart(minorUnit + 1, "0");
  const magnitude = minorUnit === 0 ? digits : `${digits.slice(0, -minorUnit)}.${digits.slice(-minorUnit)}`;
  return `${allowNegative && amountMinor < 0 ? "-" : ""}${magnitude}`;
}

/** Keeps separators for validation, even for JPY, so filtering cannot multiply a pasted amount. */
export function filterAmountInput(amount: string, allowNegative = false): string {
  let hasSeparator = false;
  return Array.from(amount.trim().replaceAll("−", "-"))
    .filter((character, index) => {
      if (character >= "0" && character <= "9") return true;
      if (allowNegative && character === "-" && index === 0) return true;
      if ((character === "." || character === ",") && !hasSeparator) {
        hasSeparator = true;
        return true;
      }
      return false;
    })
    .join("");
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
  locale = "en",
): number | "amountInvalid" | "amountDecimals" | "amountTooLarge" {
  const acceptsComma = ["de", "uk"].includes(locale.split("-")[0]);
  const normalized = acceptsComma ? amount.trim().replace(",", ".") : amount.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(normalized);
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
export const MAX_NOTES_LENGTH = 2000;
export const MAX_TRANSACTION_MERCHANT_LENGTH = 100;

export const transactionErrorCodes = [
  "typeInvalid",
  "amountRequired",
  "amountNotPositive",
  "amountInvalid",
  "amountDecimals",
  "amountTooLarge",
  "descriptionRequired",
  "descriptionTooLong",
  "merchantTooLong",
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
  locale = "en",
): number | "amountRequired" | "amountNotPositive" | "amountInvalid" | "amountDecimals" | "amountTooLarge" {
  const trimmed = amount.trim();
  if (trimmed === "") return "amountRequired";
  if (trimmed.startsWith("-")) return "amountNotPositive";
  const minor = toMinorUnits(trimmed, minorUnit, locale);
  if (typeof minor === "string") return minor;
  return minor === 0 ? "amountNotPositive" : minor;
}

/** The account fields the edit form can change. */
export type EditableAccountFields = {
  openingBalanceMinor: number;
  name: string;
  type: AccountType;
  institution: string | null;
  accountRef: string | null;
};

/** The transaction fields the edit form can change (type and account stay fixed). */
export type EditableTransactionFields = {
  description: string | null;
  merchant: string | null;
  bookedOn: string;
  categoryId: string | null;
  notes: string | null;
};

/**
 * Returns only the fields that differ from `original`: the body for a PATCH
 * (`/accounts/:id`, `/transactions/:id`). An empty optional text and `null`
 * both mean "not set", so switching between them is not a change.
 */
export function changedFields<Fields extends Record<string, string | number | null>>(
  original: Fields,
  next: Fields,
): Partial<Fields> {
  const notSetIsNull = (value: string | number | null) => (value === "" ? null : value);
  return Object.fromEntries(
    (Object.keys(next) as (keyof Fields)[])
      .filter((field) => notSetIsNull(next[field]) !== notSetIsNull(original[field]))
      .map((field) => [field, next[field]]),
  ) as Partial<Fields>;
}

// Categories. These mirror the backend's category rules (routes/category.ts).
// The types a user can give a category, which are also the types of a regular (non-transfer)
// transaction. Transfers have no category.
export const CATEGORY_TYPES = ["expense", "income"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];
export const MAX_CATEGORY_NAME_LENGTH = 80;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type EditableCategoryFields = {
  name: string;
  icon: string;
  color: string;
  types: CategoryType[];
};

/**
 * Returns only the fields that differ from `original`: the body for
 * `PATCH /categories/:id`. Colors compare case-insensitively and types as a set,
 * since the backend stores both normalized.
 */
export function changedCategoryFields(
  original: EditableCategoryFields,
  next: EditableCategoryFields,
): Partial<EditableCategoryFields> {
  const sameTypes =
    next.types.length === original.types.length && next.types.every((type) => original.types.includes(type));
  return {
    ...(next.name === original.name ? {} : { name: next.name }),
    ...(next.icon === original.icon ? {} : { icon: next.icon }),
    ...(next.color.toUpperCase() === original.color.toUpperCase() ? {} : { color: next.color }),
    ...(sameTypes ? {} : { types: next.types }),
  };
}

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

/** `#RRGGBB` for an HSL colour: hue 0–360, saturation and lightness 0–100. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

/** Hue (0–360) and lightness (0–100) of a #RRGGBB colour, rounded: the custom colour sliders' positions. */
export function hueAndLightness(hex: string): { hue: number; lightness: number } {
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const lightness = Math.round((max * 2 - delta) * 50);
  if (delta === 0) return { hue: 0, lightness };
  const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: Math.round((sector * 60 + 360) % 360), lightness };
}
