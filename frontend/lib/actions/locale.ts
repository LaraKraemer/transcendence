"use server";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Saves the visitor's language choice. The caller refreshes the router so the
 * root layout re-renders with the new `lang`, `dir`, and messages.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}
