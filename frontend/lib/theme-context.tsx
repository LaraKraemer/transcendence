"use client";

import { createContext, FC, ReactNode, useContext, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

type ThemeContext = {
  theme: Theme;
  setTheme?: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContext>({
  theme: "light",
});

type Props = {
  initial: Theme;
  children: ReactNode;
};

export const ThemeProvider: FC<Props> = ({ initial, children }) => {
  const [theme, setTheme] = useState(initial);

  const _setTheme = (next: Theme) => {
    setTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: _setTheme }}>
      <div
        className={`min-h-full flex flex-col bg-background ${theme === "dark" ? "dark" : ""}`}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
