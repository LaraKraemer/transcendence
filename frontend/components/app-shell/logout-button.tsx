"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useAuth } from "@/lib/auth-context";

export function LogoutButton({ variant = "icon" }: { variant?: "icon" | "block" }) {
  const t = useTranslations("nav");
  const { logout } = useAuth();
  const [isPending, startTransition] = useTransition();

  if (variant === "icon") {
    return (
      <IconButton
        label={t("logout")}
        variant="outline-danger"
        size="xl"
        onClick={() => startTransition(logout)}
        disabled={isPending}
      >
        <LogOut size={18} aria-hidden className="rtl:-scale-x-100" />
      </IconButton>
    );
  }

  return (
    <button
      type="button"
      onClick={() => startTransition(logout)}
      disabled={isPending}
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card p-3.5 text-sm font-semibold text-destructive transition-colors hover:bg-danger-bg focus-ring disabled:cursor-wait disabled:opacity-60"
    >
      <LogOut size={16} aria-hidden className="rtl:-scale-x-100" />
      {t("logout")}
    </button>
  );
}
