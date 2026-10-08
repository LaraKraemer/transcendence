"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { locales, localeNames } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale";

/**
 * Language picker. Saves the choice in a cookie (server action), then refreshes
 * so the root layout re-renders with the new `lang`, `dir`, and messages —
 * client state such as half-typed form input survives the switch.
 */
export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className="relative flex h-[42px] items-center rounded-[11px] border border-border bg-card text-foreground focus-within:ring-2 focus-within:ring-ring">
      <Languages size={17} aria-hidden className="pointer-events-none absolute start-3 text-muted-foreground" />
      <label htmlFor="locale-switcher" className="sr-only">
        {t("language")}
      </label>
      <select
        id="locale-switcher"
        value={locale}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none rounded-[11px] bg-transparent ps-9 pe-3 text-[13px] font-semibold outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {locales.map((code) => (
          <option key={code} value={code} lang={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
