import { db } from "./client.ts";
import { currencies } from "./schema.ts";

/** Lists global currency reference data ordered by code. */
export async function listCurrencies() {
  return db.select().from(currencies).orderBy(currencies.code);
}
