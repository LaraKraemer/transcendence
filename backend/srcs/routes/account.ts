import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import {
  deleteOwnedAccount,
  findOwnedAccount,
  hasTransactions,
  insertAccount,
  listActiveAccounts,
  sumTransactions,
  updateAccount,
} from "../db/accounts.ts";
import { isCurrencyCode, isUuid, parseOptionalText, parseRequiredText, TEXT_LIMITS } from "../validation.ts";

const ACCOUNT_TYPES = ["checking", "savings", "cash"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && ACCOUNT_TYPES.includes(value as AccountType);
}

export const accountsRouter = Router();

accountsRouter.use(requireAuthenticatedUser);

/** Returns all non-archived accounts belonging to the authenticated user. */
accountsRouter.get("/", async (_req, res) => {
  const rows = await listActiveAccounts(res.locals.userId);
  res.json(rows);
});

/** Creates an account owned by the authenticated user. */
accountsRouter.post("/", async (req, res) => {
  const { name, type, openingBalanceMinor, institution, accountRef, currencyCode } = req.body ?? {};

  const accountName = parseRequiredText(name, TEXT_LIMITS.accountName);
  if (accountName === undefined) {
    res.status(400).json({ error: `name must be between 1 and ${TEXT_LIMITS.accountName} characters` });
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

  // Omitted optional text is stored as null.
  const institutionText = parseOptionalText(institution ?? null, TEXT_LIMITS.institution);
  if (institutionText === undefined) {
    res
      .status(400)
      .json({ error: `institution must be a string of at most ${TEXT_LIMITS.institution} characters or null` });
    return;
  }

  const accountRefText = parseOptionalText(accountRef ?? null, TEXT_LIMITS.accountRef);
  if (accountRefText === undefined) {
    res
      .status(400)
      .json({ error: `accountRef must be a string of at most ${TEXT_LIMITS.accountRef} characters or null` });
    return;
  }

  if (currencyCode !== undefined && !isCurrencyCode(currencyCode)) {
    res.status(400).json({ error: "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)" });
    return;
  }

  const account = await insertAccount({
    userId: res.locals.userId,
    name: accountName,
    type,
    ...(openingBalanceMinor === undefined ? {} : { openingBalanceMinor }),
    institution: institutionText,
    accountRef: accountRefText,
    ...(currencyCode === undefined ? {} : { currencyCode }),
  });

  res.status(201).json(account);
});

/** Calculates the balance of an owned account, including archived accounts. */
accountsRouter.get("/:accountId/balance", async (req, res) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const transactionSum = await sumTransactions(account.id);
  const balanceMinor = account.openingBalanceMinor + transactionSum;
  res.json({ balanceMinor, currencyCode: account.currencyCode });
});

/** Returns one account owned by the authenticated user. */
accountsRouter.get("/:accountId", async (req, res) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.json(account);
});

/** Updates the editable properties of an account owned by the authenticated user. */
accountsRouter.patch("/:accountId", async (req, res) => {
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
    isArchived?: boolean;
  } = {};

  if (Object.hasOwn(body, "name")) {
    const accountName = parseRequiredText(body.name, TEXT_LIMITS.accountName);
    if (accountName === undefined) {
      res.status(400).json({ error: `name must be between 1 and ${TEXT_LIMITS.accountName} characters` });
      return;
    }
    updates.name = accountName;
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
      const text = parseOptionalText(body[field], TEXT_LIMITS[field]);
      if (text === undefined) {
        res
          .status(400)
          .json({ error: `${field} must be a string of at most ${TEXT_LIMITS[field]} characters or null` });
        return;
      }
      updates[field] = text;
    }
  }

  if (Object.hasOwn(body, "currencyCode")) {
    if (!isCurrencyCode(body.currencyCode)) {
      res.status(400).json({ error: "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)" });
      return;
    }
    updates.currencyCode = body.currencyCode;
  }

  if (Object.hasOwn(body, "isArchived")) {
    if (typeof body.isArchived !== "boolean") {
      res.status(400).json({ error: "isArchived must be a boolean" });
      return;
    }
    updates.isArchived = body.isArchived;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one editable account field" });
    return;
  }

  const account = await findOwnedAccount(req.params.accountId, res.locals.userId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (account.isArchived && !(Object.keys(updates).length === 1 && updates.isArchived !== undefined)) {
    res.status(409).json({ error: "Account is archived. Restore it before making changes." });
    return;
  }

  if (
    updates.currencyCode !== undefined &&
    updates.currencyCode !== account.currencyCode &&
    (await hasTransactions(account.id))
  ) {
    res.status(409).json({
      error: "currencyCode cannot be changed while the account contains transactions",
    });
    return;
  }

  const updatedAccount = await updateAccount(account.id, updates);
  res.json(updatedAccount);
});

/** Permanently deletes an owned account, including all of its transactions. */
accountsRouter.delete("/:accountId", async (req, res, next) => {
  if (!isUuid(req.params.accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  try {
    const deleted = await deleteOwnedAccount(req.params.accountId, res.locals.userId);
    if (!deleted) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
