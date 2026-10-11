import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

// Placeholder page so the /profile avatar links resolve; the real page lands in a later frontend issue.
export default async function ProfilePage() {
  const t = await getTranslations();
  return (
    <div className="flex flex-1 flex-col gap-4 pt-2">
      <div className="flex items-center gap-3">
        {/* Mobile only: the More tab is where profile is opened from on small screens. */}
        <Link
          href="/more"
          title={t("nav.back")}
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-card transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:hidden"
        >
          <ChevronLeft size={18} aria-hidden className="rtl:-scale-x-100" />
          <span className="sr-only">{t("nav.back")}</span>
        </Link>
        <h1 className="text-[15px] font-bold lg:text-2xl lg:font-semibold">{t("nav.profile")}</h1>
      </div>
      <p className="flex flex-1 items-center justify-center text-muted-foreground">{t("common.comingSoon")}</p>
    </div>
  );
}
