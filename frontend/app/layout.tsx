import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import "./globals.css";

import { getDirection } from "@/i18n/config";
import { AuthProvider } from "@/lib/auth-context";
import { getCurrentUser } from "@/lib/dal";
import { getTheme } from "@/lib/theme.server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Persian script. Only the Persian locale puts it in the font stack (see
// globals.css), so other languages never download it.
const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic"],
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: {default: t("appTitle"), template: `%s · ${t("appTitle")}`},
    description: t("appDescription"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [user, theme, locale] = await Promise.all([getCurrentUser(), getTheme(), getLocale()]);

  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      className={`${geistSans.variable} ${geistMono.variable} ${vazirmatn.variable} h-full antialiased ${theme === "dark" ? "dark" : ""}`}
    >
      <body className="min-h-full flex flex-col bg-background font-sans text-foreground">
        <NextIntlClientProvider>
          <AuthProvider initialUser={user}>{children}</AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
