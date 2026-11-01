import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { LogoutButton } from "@/components/app-shell/logout-button";
import { NavLinks } from "@/components/app-shell/nav-links";
import { LegalFooter } from "@/components/legal/legal-footer";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { NewTransactionFab } from "@/components/transactions/new-transaction-fab";
import { UserAvatar } from "@/components/user-avatar";

export function Avatar({
  displayName,
  avatarUrl,
  label,
}: {
  displayName: string;
  avatarUrl: string | null;
  label: string;
}) {
  return (
    <Link
      href="/profile"
      className="shrink-0 rounded-full transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
    >
      <UserAvatar
        displayName={displayName}
        avatarUrl={avatarUrl}
        alt={displayName}
        className="size-9 bg-primary text-[13px] font-semibold text-primary-foreground"
      />
      <span className="sr-only">, {label}</span>
    </Link>
  );
}

export async function AppShell({
  displayName,
  email,
  avatarUrl,
  children,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
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

      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col gap-5 border-e border-border bg-card px-4 py-5 lg:flex print:hidden">
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
          {/* One link for avatar and text; the logout button stays outside it. */}
          <Link
            href="/profile"
            aria-label={`${displayName}, ${t("profile")}`}
            className="-m-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] p-1.5 transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <UserAvatar
              displayName={displayName}
              avatarUrl={avatarUrl}
              alt=""
              className="size-9 bg-primary text-[13px] font-semibold text-primary-foreground"
            />
            <div className="min-w-0 flex-1 leading-[1.3]">
              <div className="truncate text-[13px] font-semibold">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            </div>
          </Link>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-end gap-2 px-8 pt-5 pb-3 lg:flex print:hidden">
          <LocaleSwitcher variant="pill" />
          <ThemeToggle variant="app" />
        </header>

        {/* tabIndex -1: the error page hands focus back here after Try again recovers. */}
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 flex-col px-4 pt-4 pb-8 outline-none lg:px-8 lg:pt-0"
        >
          {children}
        </main>
        <LegalFooter className="px-20 pb-24 lg:px-4 lg:pb-3 print:hidden" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card lg:hidden print:hidden">
        <div className="absolute end-4 bottom-full mb-4">
          <Suspense fallback={null}>
            <NewTransactionFab />
          </Suspense>
        </div>
        <NavLinks variant="tabs" />
      </div>
    </div>
  );
}
