import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import {
  findOwnedAccount,
  hasTransactions,
  insertAccount,
  listActiveAccounts,
  sumTransactions,
  updateAccount,
} from "../db/accounts.ts";
import { isCurrencyCode, isUuid } from "../validation.ts";

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

  const account = await insertAccount({
    userId: res.locals.userId,
    name: name.trim(),
    type,
    ...(openingBalanceMinor === undefined ? {} : { openingBalanceMinor }),
    ...(institution === undefined ? {} : { institution: institution.trim() }),
    ...(accountRef === undefined ? {} : { accountRef: accountRef.trim() }),
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
