import type { ReactNode } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { getTheme } from "@/lib/theme.server";

export async function AuthShell({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  const theme = await getTheme();

  return (
    <main className="flex flex-1 items-center justify-center px-4 pt-20 pb-16 sm:p-10">
      <div className="fixed end-5 top-5 z-10 flex gap-2">
        <LocaleSwitcher />
        <ThemeToggle initialTheme={theme} />
      </div>
      <div className="grid w-full max-w-[1080px] overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_30px_70px_rgba(8,14,25,.14)] lg:min-h-[640px] lg:grid-cols-2">
        <div className="hidden lg:flex">{hero}</div>
        <div className="flex flex-col justify-center px-6 py-10 sm:px-[52px] sm:py-12">
          <div className="mx-auto w-full max-w-[400px]">{children}</div>
        </div>
      </div>
    </main>
  );
}
