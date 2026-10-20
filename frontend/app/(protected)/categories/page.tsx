import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CategoryIcon } from "@/components/categories/category-icon";
import { NewCategoryButton } from "@/components/categories/category-form-dialog";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { getCategories } from "@/lib/dal";
import { CATEGORY_KINDS, HEX_COLOR_PATTERN, readableOn, type CategoryKind } from "@/lib/validation";

const KIND_STYLE: Record<CategoryKind, { icon: LucideIcon; className: string; badge: string }> = {
  expense: {
    icon: ArrowUpRight,
    className: "bg-danger-bg text-destructive rtl:-scale-x-100",
    // The light-mode red on its tint is 3.95:1 at this size; red-700 is 5.3:1 (dark mode passes as is).
    badge: "bg-danger-bg text-red-700 dark:text-destructive",
  },
  income: {
    icon: ArrowDownLeft,
    className: "bg-success-bg text-success rtl:-scale-x-100",
    badge: "bg-success-bg text-success",
  },
  transfer: {
    icon: ArrowLeftRight,
    className: "bg-muted text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("categories") };
}

/**
 * Categories, grouped by kind (expenses first, then income, then transfers) and
 * sorted by name. Laid out after docs/design/desktop/categories.html, with
 * groups by kind instead of the design's budgets (the backend has none).
 */
export default async function CategoriesPage() {
  const [t, locale, categories] = await Promise.all([getTranslations("categories"), getLocale(), getCategories()]);

  const byName = new Intl.Collator(locale).compare;
  const groups = CATEGORY_KINDS.map((kind) => ({
    kind,
    categories: categories.filter((category) => category.kind === kind).sort((a, b) => byName(a.name, b.name)),
  })).filter((group) => group.categories.length > 0);

  return (
    // The live region announces "created" to screen readers.
    <LiveStatusProvider>
      <div className="mx-auto w-full max-w-6xl pt-2">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { count: categories.length })}</p>
          </div>
          <div className="ms-auto">
            <NewCategoryButton variant="header" />
          </div>
        </div>

        {groups.length === 0 ? (
          <section className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </section>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(({ kind, categories: groupCategories }) => {
              const { icon: KindIcon, className, badge } = KIND_STYLE[kind];
              const groupHeadingId = `categories-${kind}`;
              return (
                <section
                  key={kind}
                  aria-labelledby={groupHeadingId}
                  className="rounded-lg border border-border bg-card p-4 sm:p-[22px]"
                >
                  <div className="mb-[18px] flex items-center gap-3">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-[11px] ${className}`}>
                      <KindIcon size={19} aria-hidden />
                    </span>
                    <div>
                      <h2 id={groupHeadingId} className="text-base font-semibold">
                        {t(`groups.${kind}`)}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t("groupCount", { count: groupCategories.length })}
                      </p>
                    </div>
                  </div>

                  {/* As many 15rem columns as fit, so long names have room whether or not the sidebar is shown. */}
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3.5">
                    {groupCategories.map((category) => {
                      // The backend validates colours, but fall back gracefully rather than inject bad CSS.
                      const color = HEX_COLOR_PATTERN.test(category.color) ? category.color : undefined;
                      return (
                        <li key={category.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-muted p-3.5">
                          {/* Filled with the category's colour; the icon is white or black, whichever
                            contrasts more, so any colour works in both themes. */}
                          <span
                            aria-hidden
                            // The faint inset ring keeps the tile's edge visible when its colour is close to the card (navy in dark mode).
                            className="flex size-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-card ring-1 ring-foreground/15 ring-inset"
                            style={color ? { backgroundColor: color, color: readableOn(color) } : undefined}
                          >
                            <CategoryIcon icon={category.icon} />
                          </span>
                          <div className="min-w-0">
                            {/* The full name, wrapped: names are at most 80 characters. */}
                            <div className="text-sm font-semibold wrap-break-word">
                              <bdi>{category.name}</bdi>
                            </div>
                            <span
                              className={`mt-0.5 inline-block rounded-full px-2 py-px text-[11px] font-semibold tracking-wide uppercase ${badge}`}
                            >
                              {t(`kinds.${category.kind}`)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                    <li className="grid">
                      <NewCategoryButton variant="tile" defaultKind={kind} />
                    </li>
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </LiveStatusProvider>
  );
}
