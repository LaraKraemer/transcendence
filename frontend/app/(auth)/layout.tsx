import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/dal";

/**
 * Wraps the auth pages (/login, /register): visitors who already have a session
 * are redirected to /dashboard instead of seeing the auth forms.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
