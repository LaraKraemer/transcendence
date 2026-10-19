"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const AnnounceContext = createContext<(message: string) => void>(() => {});

/**
 * A polite `role="status"` live region for results a screen reader should hear
 * ("“Savings” archived"). It is on the page from the start, because most screen
 * readers ignore a region that appears together with its text, and it sits
 * outside the list, so it survives the row that triggered it.
 */
export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const announce = useCallback((next: string) => {
    // Clear first, so the same message twice in a row is announced again.
    setMessage("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(next), 100);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <p role="status" className="sr-only">
        {message}
      </p>
    </AnnounceContext.Provider>
  );
}

/** Returns `announce(message)`; a no-op outside a LiveStatusProvider. */
export const useAnnounce = () => useContext(AnnounceContext);
