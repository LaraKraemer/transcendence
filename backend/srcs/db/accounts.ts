import { and, eq } from "drizzle-orm";

import { db } from "./client.ts";
import { accounts } from "./schema.ts";

/** Finds an owned account, including archived accounts unless explicitly excluded. */
export async function  findOwnedAccount(
  accountId: string,
  userId: string,
  allowArchived = true,
) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        allowArchived ? undefined : eq(accounts.isArchived, false),
      ),
    )
    .limit(1);

  return account;
}
