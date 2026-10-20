"use client";

import { SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonClassName, type ButtonVariant } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

/** The heading's id, so the error page can move focus to it. */
const STATUS_HEADING_ID = "status-heading";

export type ErrorStatusProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Shared layout of the 404 and error pages: an icon, the page's only <h1>, a short
 * explanation, an optional reference code and the actions, centred in a card.
 *
 * `standalone` is for pages outside the app shell, which has the <main> landmark and the
 * switchers: there the card brings its own <main> and the auth pages' language and theme switchers.
 */
function StatusPage({
  icon: Icon,
  title,
  description,
  reference,
  standalone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  reference?: string | undefined;
  standalone: boolean;
  children: ReactNode;
}) {
  const Wrapper = standalone ? "main" : "div";
  return (
    // Inside the app shell, <main> already has the horizontal padding.
    <Wrapper className={`flex flex-1 items-center justify-center pb-12 ${standalone ? "px-4 pt-20" : "pt-12"}`}>
      {standalone && (
        <div className="fixed end-5 top-5 z-10 flex gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      )}
      <div className="w-full max-w-md rounded-(--radius) border border-border bg-card p-7 text-center sm:p-9">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon size={26} aria-hidden />
        </span>
        {/* tabIndex -1: the error page moves focus here, because it replaces the content without a navigation. */}
        <h1 id={STATUS_HEADING_ID} tabIndex={-1} className="text-[22px] font-bold tracking-[-0.02em] outline-none">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {reference && <p className="mt-3 text-xs text-muted-foreground">{reference}</p>}
        <div className="mt-7 flex flex-col gap-3">{children}</div>
      </div>
    </Wrapper>
  );
}

/** Logged out, /accounts would only redirect to /login, so the link goes there and says so. */
function HomeLink({ variant }: { variant: ButtonVariant }) {
  const t = useTranslations("status");
  const { user } = useAuth();
  return (
    <Link href={user ? "/accounts" : "/login"} className={buttonClassName(variant)}>
      {t(user ? "toAccounts" : "toSignIn")}
    </Link>
  );
}

/** The 404 page's content, for app/not-found.tsx and the protected 404 inside the app shell. */
export function NotFoundStatus({ standalone }: { standalone: boolean }) {
  const t = useTranslations("status.notFound");
  return (
    <StatusPage icon={SearchX} title={t("title")} description={t("description")} standalone={standalone}>
      <HomeLink variant="primary" />
    </StatusPage>
  );
}

/**
 * The error page's content, for both error.tsx files. Shows the digest, which matches the
 * server log, as a reference code, never `error.message`: it can contain internal details.
 * Next.js already logs the error to the browser console, so client-side errors leave a trace too.
 */
export function ErrorStatus({ error, retry, standalone }: ErrorStatusProps & { standalone: boolean }) {
  const t = useTranslations();
  useEffect(() => {
    // The content is replaced without a navigation, so move focus to tell screen reader users.
    document.getElementById(STATUS_HEADING_ID)?.focus();
    // After Try again recovers, the focused button is gone and focus would fall back to <body>,
    // so continue from the recovered page's <main>.
    return () => {
      if (document.activeElement === document.body) document.querySelector("main")?.focus();
    };
  }, []);

  return (
    <>
      {/* An error boundary is a client component and can't export metadata, so React's <title>. */}
      <title>{`${t("status.error.title")} · ${t("metadata.appTitle")}`}</title>
      <StatusPage
        icon={TriangleAlert}
        title={t("status.error.title")}
        description={t("status.error.description")}
        reference={error.digest && t("status.error.reference", { code: error.digest })}
        standalone={standalone}
      >
        {/* retry() fetches the data again, so a temporary backend problem can recover without a reload. */}
        <Button onClick={() => retry()}>{t("status.error.retry")}</Button>
        <HomeLink variant="outline" />
      </StatusPage>
    </>
  );
}
