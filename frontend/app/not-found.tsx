import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/app-shell/app-shell";
import { NotFoundStatus } from "@/components/status-page";
import { getCurrentUser } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("status.notFound");
  return { title: t("title") };
}

/**
 * The 404 page for URLs that match no route and `notFound()` in public pages
 * ((protected)/not-found.tsx covers the protected ones). Logged-in users keep the app shell,
 * so a typo in the URL doesn't drop them out of the app.
 */
export default async function NotFound() {
  const user = await getCurrentUser();
  if (!user) return <NotFoundStatus standalone />;
  return (
    <AppShell displayName={user.displayName} email={user.email}>
      <NotFoundStatus standalone={false} />
    </AppShell>
  );
}
