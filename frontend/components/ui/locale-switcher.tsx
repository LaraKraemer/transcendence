"use client";

import { Check, ChevronDown, Globe, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";

import { locales, localeNames } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale";

/**
 * Language picker. Saves the choice in a cookie (server action), then refreshes
 * so the root layout re-renders with the new `lang`, `dir`, and messages —
 * client state such as half-typed form input survives the switch.
 *
 * `variant="list"` renders the languages as a tappable list (the mobile More
 * page shows it below its own Language button) instead of a `<select>`.
 * `variant="pill"` is the compact "🌐 EN ▾" button from the in-app header
 * (dashboard.html / profile.html); `"select"` matches the auth pages.
 */
export function LocaleSwitcher({ variant = "select" }: { variant?: "select" | "pill" | "list" }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Unique per instance: the header and the design system page can show more than one.
  const selectId = useId();

  function onChange(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  if (variant === "list") {
    return (
      <ul aria-label={t("language")} className="pb-2">
        {locales.map((code) => (
          <li key={code}>
            <button
              type="button"
              lang={code}
              aria-pressed={code === locale}
              disabled={isPending}
              onClick={() => onChange(code)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm hover:bg-accent focus-ring disabled:cursor-wait disabled:opacity-60 aria-pressed:font-semibold"
            >
              <span className="flex w-[22px] justify-center">
                {code === locale && <Check size={16} aria-hidden className="text-success" />}
              </span>
              {localeNames[code]}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const options = locales.map((code) => (
    <option key={code} value={code} lang={code}>
      {localeNames[code]}
    </option>
  ));

  if (variant === "pill") {
    // The native <select> sits invisibly on top, so keyboard, screen readers and
    // the OS picker still work.
    return (
      <div className="relative flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-medium text-foreground focus-within:ring-2 focus-within:ring-ring">
        <Globe size={16} aria-hidden />
        <span aria-hidden>{locale.toUpperCase()}</span>
        <ChevronDown size={14} aria-hidden />
        <label htmlFor={selectId} className="sr-only">
          {t("language")}
        </label>
        <select
          id={selectId}
          value={locale}
          disabled={isPending}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-wait"
        >
          {options}
        </select>
      </div>
    );
  }

  return (
    <div className="relative flex h-[42px] items-center rounded-[11px] border border-border bg-card text-foreground focus-within:ring-2 focus-within:ring-ring">
      <Languages size={17} aria-hidden className="pointer-events-none absolute start-3 text-muted-foreground" />
      <label htmlFor={selectId} className="sr-only">
        {t("language")}
      </label>
      <select
        id={selectId}
        value={locale}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none rounded-[11px] bg-transparent ps-9 pe-3 text-[13px] font-semibold outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {options}
      </select>
    </div>
  );
}
