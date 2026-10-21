import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CategoryIcon } from "@/components/categories/category-icon";
import { NewCategoryButton } from "@/components/categories/category-form-dialog";
import { CategoryTileActions } from "@/components/categories/category-tile-actions";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { getCategories } from "@/lib/dal";
import { HEX_COLOR_PATTERN, readableOn, type CategoryType } from "@/lib/validation";

const TYPE_BADGE: Record<CategoryType, string> = {
  // The light-mode red on its tint is 3.95:1 at this size; red-700 is 5.3:1 (dark mode passes as is).
  expense: "bg-danger-bg text-red-700 dark:text-destructive",
  income: "bg-success-bg text-success",
};

const CATEGORIES_HEADING_ID = "categories-heading";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("categories") };
}

/**
 * All categories in one list, sorted by name. Each tile shows its types (Expense, Income or both)
 * as tags. Laid out after docs/design/desktop/categories.html, without the design's budgets (the
 * backend has none).
 */
export default async function CategoriesPage() {
  const [t, locale, categories] = await Promise.all([getTranslations("categories"), getLocale(), getCategories()]);

  const byName = new Intl.Collator(locale).compare;
  const sortedCategories = categories.toSorted((a, b) => byName(a.name, b.name));

  return (
    // The live region announces "created", "saved" and "deleted" to screen readers.
    <LiveStatusProvider>
      <div className="mx-auto w-full max-w-6xl pt-2">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            {/* tabIndex -1: focus lands here after a deleted tile disappears. */}
            <h1
              id={CATEGORIES_HEADING_ID}
              tabIndex={-1}
              className="text-[26px] font-bold tracking-[-0.02em] outline-none"
            >
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { count: categories.length })}</p>
          </div>
          <div className="ms-auto">
            <NewCategoryButton variant="header" />
          </div>
        </div>

        {categories.length === 0 ? (
          <section className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </section>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 sm:p-[22px]">
            {/* As many 15rem columns as fit, so long names have room whether or not the sidebar is shown. */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3.5">
              {sortedCategories.map((category) => {
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
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {category.types.map((categoryType) => (
                          <span
                            key={categoryType}
                            className={`inline-block rounded-full px-2 py-px text-[11px] font-semibold tracking-wide uppercase ${TYPE_BADGE[categoryType]}`}
                          >
                            {t(`types.${categoryType}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <CategoryTileActions category={category} headingId={CATEGORIES_HEADING_ID} />
                  </li>
                );
              })}
              <li className="grid">
                <NewCategoryButton variant="tile" />
              </li>
            </ul>
          </div>
        )}
      </div>
    </LiveStatusProvider>
  );
}
