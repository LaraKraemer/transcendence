import { and, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

import { db } from "./client.ts";
import { appUsers, recoveryCodes, sessions } from "./schema.ts";

/** Reads the user's 2FA state, including the encrypted secret and the password hash flag. */
export async function findTotpState(userId: string) {
  const [user] = await db
    .select({
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      totpSecretEncrypted: appUsers.totpSecretEncrypted,
      totpEnabledAt: appUsers.totpEnabledAt,
      totpLastUsedStep: appUsers.totpLastUsedStep,
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return user;
}

/** Stores a not-yet-active secret. Returns false when 2FA is already on. */
export async function saveTotpSecret(userId: string, encryptedSecret: string) {
  const rows = await db
    .update(appUsers)
    .set({ totpSecretEncrypted: encryptedSecret, updatedAt: new Date() })
    .where(and(eq(appUsers.id, userId), isNull(appUsers.totpEnabledAt)))
    .returning({ id: appUsers.id });
  return rows.length > 0;
}

/**
 * Turns 2FA on and replaces the recovery codes in one transaction. The enrolment step counts
 * as used so the setup code cannot be replayed at login. Returns false when 2FA is already on.
 */
export async function activateTotp(userId: string, step: number, codeHashes: string[]) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(appUsers)
      .set({ totpEnabledAt: now, totpLastUsedStep: step, updatedAt: now })
      .where(and(eq(appUsers.id, userId), isNull(appUsers.totpEnabledAt), isNotNull(appUsers.totpSecretEncrypted)))
      .returning({ id: appUsers.id });
    if (rows.length === 0) return false;
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
    return true;
  });
}

/** Marks a step as used. False means that step (or a newer one) was already used: a replay. */
export async function claimTotpStep(userId: string, step: number) {
  const rows = await db
    .update(appUsers)
    .set({ totpLastUsedStep: step })
    .where(and(eq(appUsers.id, userId), or(isNull(appUsers.totpLastUsedStep), lt(appUsers.totpLastUsedStep, step))))
    .returning({ id: appUsers.id });
  return rows.length > 0;
}

/** Burns a recovery code. Atomic, so a code works exactly once even for concurrent requests. */
export async function burnRecoveryCode(userId: string, codeHash: string) {
  const rows = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  return rows.length > 0;
}

/** Turns 2FA off, deletes the recovery codes and revokes every session except the current one. */
export async function deactivateTotp(userId: string, currentSessionId: string) {
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(appUsers)
      .set({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastUsedStep: null, updatedAt: now })
      .where(eq(appUsers.id, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId), isNull(sessions.revokedAt)));
  });
}
