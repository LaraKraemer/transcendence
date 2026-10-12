import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("transactions") };
}

export default async function TransactionsPage() {
  const t = await getTranslations();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-2xl font-semibold">{t("nav.transactions")}</h1>
      <p className="text-muted-foreground">{t("common.comingSoon")}</p>
    </div>
  );
}
