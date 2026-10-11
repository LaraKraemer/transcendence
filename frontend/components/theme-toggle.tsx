"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { THEME_COOKIE, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Notifies on `<html class>` changes, so every mounted toggle follows a switch made by another. */
function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * Light/dark switch. The `<html>` class is the source of truth (the app shell can mount two of
 * these: the desktop header and the mobile More page); `initialTheme` covers the server render.
 */
export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("common");
  const theme = useSyncExternalStore<Theme>(
    subscribeToThemeClass,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => initialTheme,
  );

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
      className="flex size-[42px] cursor-pointer items-center justify-center rounded-[11px] border border-border bg-card text-foreground transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
