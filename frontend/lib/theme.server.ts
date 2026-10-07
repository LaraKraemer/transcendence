import "server-only";

import { cookies } from "next/headers";

import { THEME_COOKIE, type Theme } from "@/lib/theme";

export async function getTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  return cookieStore.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
}
