import { getTranslations } from "next-intl/server";

export default async function AccountsPage() {
  const t = await getTranslations();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-2xl font-semibold">{t("nav.accounts")}</h1>
      <p className="text-muted-foreground">{t("common.comingSoon")}</p>
    </div>
  );
}
