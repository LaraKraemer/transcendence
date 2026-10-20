import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ProfileDetails } from "@/components/profile/profile-details";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { getCurrentUser } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("profile") };
}

export default async function ProfilePage() {
  // The user lookup is cached per request, so it reuses the layout's.
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    // The live region announces photo and name changes to screen readers.
    <LiveStatusProvider>
      <ProfileDetails user={user} />
    </LiveStatusProvider>
  );
}
