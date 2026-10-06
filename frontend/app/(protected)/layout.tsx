import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/dal";

/**
 * Guards every route in the (protected) group: unauthenticated visitors are
 * redirected to /login before any protected content renders.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
