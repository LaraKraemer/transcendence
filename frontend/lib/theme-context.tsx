"use client";

import { createContext, type FC, type ReactNode, useContext, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

type Props = {
  initial: Theme;
  children: ReactNode;
};

export const ThemeProvider: FC<Props> = ({ initial, children }) => {
  const [theme, setTheme] = useState(initial);

  const _setTheme = (next: Theme) => {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  };

  return <ThemeContext.Provider value={{ theme, setTheme: _setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
