import "dotenv/config";

import { db, pool } from "./client.ts";
import { currencies } from "./schema.ts";

/** Inserts missing global currency reference data without changing existing rows. */
async function seed(): Promise<void> {
  await db
    .insert(currencies)
    .values([
      { code: "EUR", name: "Euro", symbol: "€", minorUnit: 2 },
      { code: "USD", name: "US Dollar", symbol: "$", minorUnit: 2 },
      { code: "GBP", name: "British Pound", symbol: "£", minorUnit: 2 },
      { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnit: 0 },
      { code: "CHF", name: "Swiss Franc", symbol: "Fr", minorUnit: 2 },
      { code: "CAD", name: "Canadian Dollar", symbol: "$", minorUnit: 2 },
      { code: "AUD", name: "Australian Dollar", symbol: "$", minorUnit: 2 },
      { code: "DKK", name: "Danish Krone", symbol: "kr", minorUnit: 2 },
      { code: "SEK", name: "Swedish Krona", symbol: "kr", minorUnit: 2 },
      { code: "NOK", name: "Norwegian Krone", symbol: "kr", minorUnit: 2 },
      { code: "PLN", name: "Polish Zloty", symbol: "zł", minorUnit: 2 },
      { code: "HUF", name: "Hungarian Forint", symbol: "Ft", minorUnit: 2 },
      { code: "CZK", name: "Czech Koruna", symbol: "Kč", minorUnit: 2 },
      { code: "RON", name: "Romanian Leu", symbol: "lei", minorUnit: 2 },
      { code: "TRY", name: "Turkish Lira", symbol: "₺", minorUnit: 2 },
      { code: "BRL", name: "Brazilian Real", symbol: "R$", minorUnit: 2 },
      { code: "CNY", name: "Chinese Yuan", symbol: "¥", minorUnit: 2 },
      { code: "KWD", name: "Kuwaiti Dinar", symbol: "KD", minorUnit: 3 },
      { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", minorUnit: 2 },
    ])
    .onConflictDoNothing();
  console.log("Currencies seeded");
}

try {
  await seed();
} finally {
  await pool.end();
}
