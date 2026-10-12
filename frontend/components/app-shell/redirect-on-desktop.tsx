"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Must match Tailwind's `lg` breakpoint, where the app shell switches to the desktop layout.
const desktopMediaQuery = "(min-width: 64rem)";

export function RedirectOnDesktop({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    const mediaQueryList = window.matchMedia(desktopMediaQuery);
    const redirectIfDesktop = () => {
      if (mediaQueryList.matches) router.replace(href);
    };

    redirectIfDesktop();
    mediaQueryList.addEventListener("change", redirectIfDesktop);
    return () => mediaQueryList.removeEventListener("change", redirectIfDesktop);
  }, [href, router]);

  return null;
}
