"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** "auth" matches sign-in.html (42px); "app" matches the in-app headers of dashboard.html/profile.html (40px). */
export function ThemeToggle({ variant = "auth" }: { variant?: "auth" | "app" }) {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
  }

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
      className={`flex ${variant === "app" ? "size-10 rounded-[10px]" : "size-[42px] rounded-[11px]"} cursor-pointer items-center justify-center border border-border bg-card text-foreground transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
