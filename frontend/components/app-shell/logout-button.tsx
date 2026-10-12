"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useAuth } from "@/lib/auth-context";

const variantClasses = {
  icon: "size-[42px] shrink-0 rounded-[11px]",
  block: "w-full gap-2 rounded-xl p-3.5 text-sm font-semibold",
};

export function LogoutButton({ variant = "icon" }: { variant?: keyof typeof variantClasses }) {
  const t = useTranslations("nav");
  const { logout } = useAuth();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(logout)}
      disabled={isPending}
      title={variant === "icon" ? t("logout") : undefined}
      className={`flex cursor-pointer items-center justify-center border border-border bg-card text-destructive transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 ${variantClasses[variant]}`}
    >
      <LogOut size={variant === "icon" ? 18 : 16} aria-hidden className="rtl:-scale-x-100" />
      <span className={variant === "icon" ? "sr-only" : undefined}>{t("logout")}</span>
    </button>
  );
}
