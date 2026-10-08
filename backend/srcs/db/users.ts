import { and, eq, isNull } from "drizzle-orm";

import { db } from "./client.ts";
import { appUsers, sessions } from "./schema.ts";

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

/** Reads the authenticated user's password hash without exposing it in public user responses. */
export async function findUserPasswordHash(id: string) {
  const [user] = await db
    .select({ passwordHash: appUsers.passwordHash })
    .from(appUsers)
    .where(and(eq(appUsers.id, id), isNull(appUsers.deletedAt)))
    .limit(1);
  return user?.passwordHash;
}

/** Atomically replaces the verified password and revokes all of the user's sessions. */
export async function updateUserPassword(id: string, previousHash: string, passwordHash: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [user] = await tx
      .update(appUsers)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
      .where(and(eq(appUsers.id, id), eq(appUsers.passwordHash, previousHash), isNull(appUsers.deletedAt)))
      .returning({ id: appUsers.id });
    // A concurrent password change must not be overwritten using stale credentials.
    if (!user) return false;
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
    return true;
  });
}
