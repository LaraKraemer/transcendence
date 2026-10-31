"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";
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
    <IconButton
      label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
      onClick={toggle}
      variant="outline"
      size={variant === "app" ? "lg" : "xl"}
    >
      <Icon size={18} aria-hidden />
    </IconButton>
  );
}
