import { and, eq, ne, sum } from "drizzle-orm";
import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { db } from "../db/client.ts";
import { accounts, transactions } from "../db/schema.ts";
import { isCurrencyCode, isUuid } from "../validation.ts";

const ACCOUNT_TYPES = ["checking", "savings", "cash"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && ACCOUNT_TYPES.includes(value as AccountType);
}

/** Finds an account only when it belongs to the authenticated user. */
async function findOwnedAccount(accountId: string, userId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1);

  return account;
}

export const accountsRouter = Router();

accountsRouter.use(requireAuthenticatedUser);

/** Returns all non-archived accounts belonging to the authenticated user. */
accountsRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, res.locals.userId),
          eq(accounts.isArchived, false),
        ),
      );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/** Creates an account owned by the authenticated user. */
accountsRouter.post("/", async (req, res, next) => {
  const { name, type, openingBalanceMinor, institution, accountRef, currencyCode } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 100) {
    res.status(400).json({ error: "name must be between 1 and 100 characters" });
    return;
  }

  if (!isAccountType(type)) {
    res.status(400).json({ error: "type must be checking, savings, or cash" });
    return;
  }

  if (openingBalanceMinor !== undefined && !Number.isSafeInteger(openingBalanceMinor)) {
    res.status(400).json({ error: "openingBalanceMinor must be a safe integer" });
    return;
  }

  if (institution !== undefined && typeof institution !== "string") {
    res.status(400).json({ error: "institution must be a string" });
    return;
  }

  if (accountRef !== undefined && typeof accountRef !== "string") {
    res.status(400).json({ error: "accountRef must be a string" });
    return;
  }

  if (currencyCode !== undefined && !isCurrencyCode(currencyCode)) {
    res.status(400).json({ error: "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)" });
    return;
  }

  try {
    const [account] = await db
      .insert(accounts)
      .values({
        userId: res.locals.userId,
        name: name.trim(),
        type,
        ...(openingBalanceMinor === undefined ? {} : { openingBalanceMinor }),
        ...(institution === undefined ? {} : { institution: institution.trim() }),
        ...(accountRef === undefined ? {} : { accountRef: accountRef.trim() }),
        ...(currencyCode === undefined ? {} : { currencyCode }),
      })
      .returning();

    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

/** Calculates the balance of an owned account, including archived accounts. */
accountsRouter.get("/:accountId/balance", async (req, res, next) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  try {
    const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const [result] = await db
      .select({ total: sum(transactions.amountMinor) })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, account.id),
          ne(transactions.status, "void"),
        ),
      );

    const transactionSum = Number(result?.total ?? 0);
    const balanceMinor = account.openingBalanceMinor + transactionSum;
    res.json({ balanceMinor, currencyCode: account.currencyCode });
  } catch (error) {
    next(error);
  }
});

/** Returns one account owned by the authenticated user. */
accountsRouter.get("/:accountId", async (req, res, next) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  try {
    const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.json(account);
  } catch (error) {
    next(error);
  }
});

/** Updates the editable properties of an account owned by the authenticated user. */
accountsRouter.patch("/:accountId", async (req, res, next) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};
  const updates: {
    name?: string;
    type?: AccountType;
    openingBalanceMinor?: number;
    institution?: string | null;
    accountRef?: string | null;
    currencyCode?: string;
  } = {};

  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 100) {
      res.status(400).json({ error: "name must be between 1 and 100 characters" });
      return;
    }
    updates.name = body.name.trim();
  }

  if (Object.hasOwn(body, "type")) {
    if (!isAccountType(body.type)) {
      res.status(400).json({ error: "type must be checking, savings, or cash" });
      return;
    }
    updates.type = body.type;
  }

  if (Object.hasOwn(body, "openingBalanceMinor")) {
    if (!Number.isSafeInteger(body.openingBalanceMinor)) {
      res.status(400).json({ error: "openingBalanceMinor must be a safe integer" });
      return;
    }
    updates.openingBalanceMinor = body.openingBalanceMinor;
  }

  for (const field of ["institution", "accountRef"] as const) {
    if (Object.hasOwn(body, field)) {
      if (body[field] !== null && typeof body[field] !== "string") {
        res.status(400).json({ error: `${field} must be a string or null` });
        return;
      }
      updates[field] = body[field] === null ? null : body[field].trim();
    }
  }

  if (Object.hasOwn(body, "currencyCode")) {
    if (!isCurrencyCode(body.currencyCode)) {
      res.status(400).json({ error: "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)" });
      return;
    }
    updates.currencyCode = body.currencyCode;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one editable account field" });
    return;
  }

  try {
    const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const [updatedAccount] = await db
      .update(accounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(accounts.id, account.id))
      .returning();

    res.json(updatedAccount);
  } catch (error) {
    next(error);
  }
});

/** Archives an account while retaining its financial history. */
accountsRouter.delete("/:accountId", async (req, res, next) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  try {
    const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    await db
      .update(accounts)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(accounts.id, account.id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
