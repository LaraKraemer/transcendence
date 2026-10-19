/**
 * The account whose transactions were opened last. The account page's switcher
 * writes it client-side; the /transactions page reads it server-side and
 * redirects there. Kept free of "use client" so server code can import the value.
 */
export const LAST_ACCOUNT_COOKIE = "lastAccountId";
