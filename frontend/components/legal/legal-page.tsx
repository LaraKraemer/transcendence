import { ArrowLeft } from "lucide-react";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { LegalFooter } from "@/components/legal/legal-footer";
import { Card } from "@/components/ui/card";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getCurrentUser } from "@/lib/dal";

/** When each document's text last changed. Change the date together with the text in all four catalogues. */
const LAST_UPDATED_ON = { privacy: "2026-10-28", terms: "2026-10-28" } as const;

type LegalSection = { title: string; paragraphs?: string[]; items?: string[] };

/**
 * The frame of a page anyone can open from the footer: the app shell when signed in, otherwise a
 * back link to sign-in with the language and theme switchers. `from` is the page's `?from=` value:
 * only "register" changes anything (the back link returns to sign-up), so it can't redirect elsewhere.
 */
export async function PublicPageShell({ from, children }: { from: string | string[] | undefined; children: ReactNode }) {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations()]);
  const fromSignUp = from === "register";

  if (user) {
    return (
      <AppShell displayName={user.displayName} email={user.email} avatarUrl={user.avatarUrl}>
        {children}
      </AppShell>
    );
  }

  return (
    <>
      {/* Not fixed like on the auth pages: on a long page the switchers would cover the text while scrolling. */}
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link
            href={fromSignUp ? "/register" : "/login"}
            className="flex items-center gap-1.5 rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-sm font-semibold hover:border-ring focus-ring"
          >
            <ArrowLeft size={16} aria-hidden className="rtl:-scale-x-100" />
            {fromSignUp ? t("auth.signIn.createAccount") : t("status.toSignIn")}
          </Link>
          <div className="flex gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {/* tabIndex -1: the error page hands focus back here after Try again recovers. */}
      <main tabIndex={-1} className="flex flex-1 flex-col px-4 py-6 outline-none sm:py-10">
        {children}
      </main>
      <LegalFooter className="pb-3" fromSignUp={fromSignUp} />
    </>
  );
}

export async function LegalPage({
  kind,
  from,
}: {
  kind: keyof typeof LAST_UPDATED_ON;
  from: string | string[] | undefined;
}) {
  const [t, format, messages] = await Promise.all([getTranslations("legal"), getFormatter(), getMessages()]);
  // Read raw, so the sections are plain text without ICU parsing, in the catalogue's key order.
  const sections: LegalSection[] = Object.values(messages.legal[kind].sections);
  const lastUpdatedOn = LAST_UPDATED_ON[kind];

  return (
    <PublicPageShell from={from}>
      <Card as="article" className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-10 sm:py-10">
        <h1 className="text-title leading-tight text-balance">{t(`${kind}.title`)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich("lastUpdated", {
            date: format.dateTime(new Date(lastUpdatedOn), { dateStyle: "long", timeZone: "UTC", calendar: "gregory" }),
            time: (chunks) => <time dateTime={lastUpdatedOn}>{chunks}</time>,
          })}
        </p>
        <p className="mt-6 leading-7">{t(`${kind}.intro`)}</p>

        {sections.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">{section.title}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-7">
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="mt-3 list-disc space-y-2 ps-5 leading-7 marker:text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </Card>
    </PublicPageShell>
  );
}
