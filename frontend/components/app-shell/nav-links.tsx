"use client";

import { ArrowLeftRight, ChartPie, LayoutGrid, Menu, Tag, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutGrid },
  { href: "/accounts", labelKey: "accounts", icon: Wallet },
  { href: "/transactions", labelKey: "transactions", icon: ArrowLeftRight },
  { href: "/analytics", labelKey: "analytics", icon: ChartPie },
  { href: "/categories", labelKey: "categories", icon: Tag },
] as const;

// Mobile only: on desktop, the More page's controls already sit in the header and sidebar.
const MORE_ITEM = { href: "/more", labelKey: "more", icon: Menu } as const;

const activePillClasses =
  "bg-primary font-semibold text-primary-foreground dark:inset-ring dark:inset-ring-ring forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]";

const variantClasses = {
  sidebar: {
    list: "flex flex-col gap-1",
    link: "flex items-center gap-3 rounded-[10px] p-2.5 text-sm transition-colors",
    active: activePillClasses,
    inactive: "font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    iconSize: 18,
  },
  tabs: {
    list: "grid grid-cols-5 gap-0.5 p-1",
    link: "flex h-full flex-col items-center gap-1 rounded-[10px] py-2 text-center text-[10px] hyphens-auto wrap-anywhere transition-colors",
    active: activePillClasses,
    inactive: "font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    iconSize: 20,
  },
};

export function NavLinks({ variant }: { variant: keyof typeof variantClasses }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const classes = variantClasses[variant];
  // Five tabs fit at 320 px, so on mobile Analytics is opened from the More page.
  const items = variant === "tabs" ? [...NAV_ITEMS.filter((item) => item.href !== "/analytics"), MORE_ITEM] : NAV_ITEMS;

  return (
    <nav aria-label={t("mainNavigation")}>
      <ul className={classes.list}>
        {items.map(({ href, labelKey, icon: Icon }) => {
          // A nested route (/accounts/123) keeps its section highlighted.
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`${classes.link} ${isActive ? classes.active : classes.inactive} focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
              >
                <Icon size={classes.iconSize} aria-hidden />
                {t(labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
