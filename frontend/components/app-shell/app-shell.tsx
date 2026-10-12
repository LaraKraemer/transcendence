import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/app-shell/logout-button";
import { NavLinks } from "@/components/app-shell/nav-links";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

/** Up to two initials; `Array.from` keeps a multi-byte first character intact. */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

const avatarClasses =
  "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground";

/**
 * Initials circle. With `link` it opens the profile page (desktop sidebar); without it, it is
 * decorative (mobile top bar), because on mobile Profile is opened from the More page only, where
 * its back button returns.
 */
function Avatar({ displayName, link }: { displayName: string; link?: { label: string } }) {
  if (!link) {
    return (
      <span aria-hidden className={avatarClasses}>
        {initialsOf(displayName)}
      </span>
    );
  }

  return (
    <Link
      href="/profile"
      aria-label={link.label}
      title={link.label}
      className={`${avatarClasses} transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none`}
    >
      <span aria-hidden>{initialsOf(displayName)}</span>
    </Link>
  );
}

export async function AppShell({
  displayName,
  email,
  children,
}: {
  displayName: string;
  email: string;
  children: ReactNode;
}) {
  const t = await getTranslations("nav");

  return (
    <div className="flex flex-1">
      <a
        href="#main"
        className="sr-only rounded-[11px] bg-card px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skipToContent")}
      </a>

      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col gap-5 border-e border-border bg-card px-4 py-5 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1.5 py-1 font-bold hover:opacity-80">
          <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
            P
          </span>
          <span className="text-lg tracking-[-0.02em]">Poolaki</span>
        </Link>

        <div>
          <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
            {t("main")}
          </div>
          <NavLinks variant="sidebar" />
        </div>

        <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5">
          <Avatar displayName={displayName} link={{ label: t("profile") }} />
          <div className="min-w-0 flex-1 leading-[1.3]">
            <div className="truncate text-[13px] font-semibold">{displayName}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-4 py-3 lg:px-8 lg:pt-5">
          <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <Avatar displayName={displayName} />
            <span className="truncate text-sm font-semibold">{displayName}</span>
          </div>
          {/* On mobile these controls live on the More page instead. */}
          <div className="ms-auto hidden shrink-0 gap-2 lg:flex">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="flex flex-1 flex-col px-4 pb-24 lg:px-8 lg:pb-12">
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card lg:hidden">
        <NavLinks variant="tabs" />
      </div>
    </div>
  );
}
