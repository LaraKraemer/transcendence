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

export function validateLogin({ email, password }: LoginFields): FieldErrors<keyof LoginFields> {
  return compact({ email: validateEmail(email), password: validatePassword(password) });
}

export function validateRegister({ email, displayName, password }: RegisterFields): FieldErrors<keyof RegisterFields> {
  return compact({
    displayName: displayName.trim() ? undefined : "displayNameRequired",
    email: validateEmail(email),
    password: validatePassword(password),
  });
}
