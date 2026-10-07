/**
 * Theme preference shared by the server (root layout) and the client toggle.
 *
 * The choice is stored in a plain cookie rather than localStorage so the root
 * layout can render the `dark` class on <html> server-side — no flash of the
 * wrong theme and no inline script. Kept free of "use client" so server code
 * can import the constant's value.
 */
export const THEME_COOKIE = "theme";

export type Theme = "light" | "dark";
