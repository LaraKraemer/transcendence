"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LEGAL_LINKS = [
  { href: "/privacy", labelKey: "privacyLink" },
  { href: "/terms", labelKey: "termsLink" },
] as const;

/**
 * `fromSignUp`: the logged-out legal page was opened from /register. The links then carry
 * `?from=register` (also when opened from /register itself), so its back link returns there.
 */
export function LegalFooter({ className = "", fromSignUp = false }: { className?: string; fromSignUp?: boolean }) {
  const t = useTranslations("legal");
  const pathname = usePathname();
  const query = fromSignUp || pathname === "/register" ? "?from=register" : "";

  return (
    <footer className={`border-t border-border px-4 pt-3 text-xs text-muted-foreground ${className}`}>
      <nav aria-label={t("navLabel")}>
        <ul className="flex justify-center">
          {LEGAL_LINKS.map(({ href, labelKey }) => (
            <li
              key={href}
              className="flex min-w-0 items-center not-first:before:mx-2 not-first:before:h-3 not-first:before:w-px not-first:before:shrink-0 not-first:before:bg-border not-first:before:content-['']"
            >
              <Link
                href={`${href}${query}`}
                aria-current={pathname === href ? "page" : undefined}
                className="inline-block rounded-md px-1 py-1 hyphens-auto wrap-anywhere underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
              >
                {t(labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
