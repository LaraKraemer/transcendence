import { ChevronDown, ChevronRight, Languages, SunMoon, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/app-shell/logout-button";
import { RedirectOnDesktop } from "@/components/app-shell/redirect-on-desktop";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { localeNames } from "@/i18n/config";
import { getCurrentUser } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("more") };
}

function SettingRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-3 py-3">
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground">
        <Icon size={17} aria-hidden />
      </span>
      <span className="text-sm font-semibold">{label}</span>
      <span className="ms-auto">{children}</span>
    </span>
  );
}

export default async function MorePage() {
  // The user lookup is cached per request, so it reuses the layout's.
  const [user, locale, t] = await Promise.all([getCurrentUser(), getLocale(), getTranslations()]);
  if (!user) {
    redirect("/login");
  }

  return (
    // lg:hidden keeps desktop from painting this page before the redirect runs.
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2 lg:hidden">
      <RedirectOnDesktop href="/profile" />
      <h1 className="text-[15px] font-bold">{t("nav.more")}</h1>

      {/* Hover lays 10% black over the gradient, so the text only gains contrast (opacity let the page show through). */}
      <Link
        href="/profile"
        className="flex items-center gap-3 rounded-(--radius) bg-(image:--grad) p-4 text-[#e6ecf5] hover:bg-[linear-gradient(rgb(0_0_0/0.1),rgb(0_0_0/0.1)),var(--grad)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {/* Decorative: the name is right next to it. */}
        <UserAvatar
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          alt=""
          className="size-[46px] bg-white/12 text-[15px] font-bold"
        />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold">{user.displayName}</span>
          <span className="block truncate text-xs">{user.email}</span>
        </span>
        <ChevronRight size={18} aria-hidden className="ms-auto shrink-0 opacity-80 rtl:-scale-x-100" />
      </Link>

      <div className="divide-y divide-border rounded-(--radius) border border-border bg-card px-[18px] py-1.5">
        {/* Native disclosure: the Language button opens the language list below it. */}
        <details className="group">
          <summary className="cursor-pointer list-none rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <SettingRow icon={Languages} label={t("common.language")}>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {localeNames[locale]}
                <ChevronDown size={16} aria-hidden className="transition-transform group-open:rotate-180" />
              </span>
            </SettingRow>
          </summary>
          <LocaleSwitcher variant="list" />
        </details>
        <SettingRow icon={SunMoon} label={t("nav.theme")}>
          <ThemeToggle />
        </SettingRow>
      </div>

      <LogoutButton variant="block" />
    </div>
  );
}
