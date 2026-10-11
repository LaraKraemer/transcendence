import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUser } from "@/lib/dal";
import { getTheme } from "@/lib/theme.server";

/**
 * Guards every route in the (protected) group: unauthenticated visitors are
 * redirected to /login before any protected content renders. Authenticated
 * pages are wrapped in the app shell (navigation, user card, logout).
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const [user, theme] = await Promise.all([getCurrentUser(), getTheme()]);
  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell displayName={user.displayName} email={user.email} theme={theme}>
      {children}
    </AppShell>
  );
}
