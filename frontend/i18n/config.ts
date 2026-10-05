export const locales = ["en", "de", "uk", "fa"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that stores the visitor's chosen language. */
export const LOCALE_COOKIE = "locale";

/** Each language's own name for itself, as shown in the switcher. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  uk: "Українська",
  fa: "فارسی",
};

const rtlLocales: readonly Locale[] = ["fa"];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Text direction for `<html dir>`; drives layout mirroring via logical properties. */
export function getDirection(locale: Locale): "ltr" | "rtl" {
  return rtlLocales.includes(locale) ? "rtl" : "ltr";
}
