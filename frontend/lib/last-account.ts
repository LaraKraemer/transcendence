/**
 * The account whose transactions were opened last; without it /transactions shows all accounts. The
 * account switcher writes it client-side (choosing "All accounts" deletes it); /transactions and the
 * dashboard read it server-side. Kept free of "use client" so server code can import the value.
 */
export const LAST_ACCOUNT_COOKIE = "lastAccountId";
