import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/i18n/config";

/**
 * Picks the first supported language from an `Accept-Language` header, honouring
 * q-weights and matching on the primary subtag ("de-AT" → "de").
 */
function negotiateLocale(acceptLanguage: string | null): Locale | undefined {
  if (!acceptLanguage) return undefined;

  return acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { language: tag.split("-")[0].toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter(({ q }) => q > 0)
    .sort((a, b) => b.q - a.q)
    .map(({ language }) => language)
    .find(isLocale);
}

/**
 * Resolves the locale for each request without locale-prefixed URLs: the
 * visitor's saved choice (cookie) wins, then the browser's preference, then the
 * default.
 */
export default getRequestConfig(async () => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved) ? saved : (negotiateLocale((await headers()).get("accept-language")) ?? defaultLocale);

  return {
    locale,
    // Fixed so server and client format dates identically (no hydration mismatch).
    timeZone: "Europe/Berlin",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
