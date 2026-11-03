"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const refreshIntervalMs = 30_000;

/** Reloads the page's server data every 30 s while the tab is visible, and as soon as a hidden tab is shown again. */
export function AnalyticsRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = setInterval(refreshIfVisible, refreshIntervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router]);

  return null;
}
