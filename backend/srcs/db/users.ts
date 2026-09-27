import { and, eq, isNull } from "drizzle-orm";

import { db } from "./client.ts";
import { appUsers } from "./schema.ts";

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(appUsers)
    .where(and(eq(appUsers.email, email), isNull(appUsers.deletedAt)))
    .limit(1);

  return user;
}

export async function findUserById(id: string) {
  const [user] = await db
    .select({ id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName })
    .from(appUsers)
    .where(eq(appUsers.id, id))
    .limit(1);

  return user;
}

export async function createUser(email: string, passwordHash: string, displayName: string) {
  const [user] = await db
    .insert(appUsers)
    .values({ email, passwordHash, displayName })
    .returning({ id: appUsers.id, email: appUsers.email, displayName: appUsers.displayName });

  return user;
}
