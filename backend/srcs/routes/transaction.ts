import { randomUUID } from "node:crypto";

import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { findOwnedAccount } from "../db/accounts.ts";
import { findOwnedCategory } from "../db/categories.ts";
import {
  countTransactionsByCategory,
  findCategoryTypes,
  findOwnedTransaction,
  insertTransaction,
  insertTransferLegs,
  listTransactions,
  summarizeTransactionsByCategory,
  updateTransaction,
  deleteTransaction,
} from "../db/transactions.ts";
import { isDateOnly, isIsoTimestamp, isUuid, parseOptionalText, TEXT_LIMITS } from "../validation.ts";

function parsePaginationInt(value: unknown, defaultValue: number): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
type TransactionType = (typeof TRANSACTION_TYPES)[number];

function isTransactionType(value: unknown): value is TransactionType {
  return typeof value === "string" && TRANSACTION_TYPES.includes(value as TransactionType);
}

/** Returns an error message when the sign of the amount contradicts an expense or income type. */
function signError(type: string, amountMinor: number): string | undefined {
  if (type === "expense" && amountMinor > 0) return "amountMinor must be negative for an expense";
  if (type === "income" && amountMinor < 0) return "amountMinor must be positive for an income";
  return undefined;
}

/**
 * Ensures a selected category is the user's own and allows the transaction
 * type. Only run when a transaction is created or its type or category is changed, never because a
 * category changed.
 */
async function validateCategory(
  categoryId: string | null,
  type: string,
  userId: string,
): Promise<{ status: 400 | 404; error: string } | undefined> {
  if (categoryId === null) return undefined;

  const category = await findCategoryTypes(categoryId, userId);

  if (!category) return { status: 404, error: "Category not found" };

  return category.types.includes(type)
    ? undefined
    : { status: 400, error: `An ${type} transaction requires a category that allows ${type}` };
}

/**
 * Validates the fields shared by regular transactions and transfers. Returns an error message, or the
 * trimmed optional `description` and `notes` (omitted values are stored as null).
 */
function parseEntryFields({
  description,
  bookedOn,
  notes,
  occurredAt,
}: Record<string, unknown>): { error: string } | { description: string | null; notes: string | null } {
  const descriptionText = parseOptionalText(description ?? null, TEXT_LIMITS.description);
  if (descriptionText === undefined) {
    return { error: `description must be a string of at most ${TEXT_LIMITS.description} characters or null` };
  }
  if (!isDateOnly(bookedOn)) return { error: "bookedOn must use YYYY-MM-DD format" };
  const notesText = parseOptionalText(notes ?? null, TEXT_LIMITS.notes);
  if (notesText === undefined) {
    return { error: `notes must be a string of at most ${TEXT_LIMITS.notes} characters or null` };
  }
  if (occurredAt !== undefined && occurredAt !== null && !isIsoTimestamp(occurredAt)) {
    return { error: "occurredAt must be a valid ISO 8601 timestamp or null" };
  }
  return { description: descriptionText, notes: notesText };
}

export const transactionsRouter = Router();

transactionsRouter.use(requireAuthenticatedUser);

/**
 * Lists transactions for one account owned by the authenticated user, or without accountId for all
 * of the user's accounts (archived ones included), where a transfer is one item.
 *
 * Optional query parameters: accountId, type, limit (default 50), offset (default 0), from, to
 */
transactionsRouter.get("/", async (req, res) => {
  const { accountId, type } = req.query;

  if (accountId !== undefined && !isUuid(accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }
  if (type !== undefined && !isTransactionType(type)) {
    res.status(400).json({ error: "type must be expense, income, or transfer" });
    return;
  }

  const limit = parsePaginationInt(req.query.limit, 50);
  const offset = parsePaginationInt(req.query.offset, 0);
  const { from, to } = req.query;

  if (limit === null || limit < 1 || limit > 200) {
    res.status(400).json({ error: "limit must be an integer between 1 and 200" });
    return;
  }
  if (offset === null) {
    res.status(400).json({ error: "offset must be a non-negative integer" });
    return;
  }
  if (from !== undefined && !isDateOnly(from)) {
    res.status(400).json({ error: "from must use YYYY-MM-DD format" });
    return;
  }
  if (to !== undefined && !isDateOnly(to)) {
    res.status(400).json({ error: "to must use YYYY-MM-DD format" });
    return;
  }

  let owner: { accountId: string } | { userId: string } = { userId: res.locals.userId };
  if (accountId !== undefined) {
    const account = await findOwnedAccount(accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    owner = { accountId: account.id };
  }

  const result = await listTransactions(owner, {
    limit,
    offset,
    ...(type === undefined ? {} : { type }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  });
  res.json(result);
});

/** Returns transaction totals by category, including uncategorized transactions. */
transactionsRouter.get("/summary", async (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const { from, to } = req.query;

  if (accountId === undefined || accountId === "") {
    res.status(400).json({ error: "accountId is required" });
    return;
  }
  if (!isUuid(accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }
  if (from !== undefined && !isDateOnly(from)) {
    res.status(400).json({ error: "from must use YYYY-MM-DD format" });
    return;
  }
  if (to !== undefined && !isDateOnly(to)) {
    res.status(400).json({ error: "to must use YYYY-MM-DD format" });
    return;
  }

  const account = await findOwnedAccount(accountId, res.locals.userId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const rows = await summarizeTransactionsByCategory(account.id, from as string | undefined, to as string | undefined);
  res.json(rows);
});

/** Returns the number of transactions linked to a category. */
transactionsRouter.get("/count/:categoryId", async (req, res, next) => {
  if (!isUuid(req.params.categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }
  try {
    const category = await findOwnedCategory(req.params.categoryId, res.locals.userId);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const transactionCount = await countTransactionsByCategory(req.params.categoryId, res.locals.userId);
    res.json({ transactionCount });
  } catch (error) {
    next(error);
  }
});

/** Returns one transaction from an account owned by the authenticated user. */
transactionsRouter.get("/:transactionId", async (req, res) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  const ownedTransaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
  if (!ownedTransaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  res.json(ownedTransaction.transaction);
});

/** Updates a transaction while preserving account ownership and category rules. */
transactionsRouter.patch("/:transactionId", async (req, res) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};

  const ownedTransaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
  if (!ownedTransaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  const { transaction } = ownedTransaction;

  if (transaction.type === "transfer") {
    res.status(400).json({ error: "Transfers cannot be edited. Delete the transfer and create a new one." });
    return;
  }

  const updates: {
    type?: string;
    categoryId?: string | null;
    amountMinor?: number;
    description?: string | null;
    notes?: string | null;
    merchant?: string | null;
    bookedOn?: string;
    occurredAt?: Date | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  let hasUpdates = false;

  if (Object.hasOwn(body, "type")) {
    if (!isTransactionType(body.type) || body.type === "transfer") {
      res.status(400).json({ error: "type must be expense or income" });
      return;
    }
    updates.type = body.type;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "amountMinor")) {
    if (!Number.isSafeInteger(body.amountMinor) || body.amountMinor === 0) {
      res.status(400).json({ error: "amountMinor must be a non-zero safe integer" });
      return;
    }
    updates.amountMinor = body.amountMinor;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "categoryId")) {
    if (body.categoryId !== null && !isUuid(body.categoryId)) {
      res.status(400).json({ error: "categoryId must be a valid UUID or null" });
      return;
    }
    updates.categoryId = body.categoryId;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "description")) {
    const description = parseOptionalText(body.description, TEXT_LIMITS.description);
    if (description === undefined) {
      res
        .status(400)
        .json({ error: `description must be a string of at most ${TEXT_LIMITS.description} characters or null` });
      return;
    }
    updates.description = description;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "merchant")) {
    const merchant = parseOptionalText(body.merchant, TEXT_LIMITS.merchant);
    if (merchant === undefined) {
      res
        .status(400)
        .json({ error: `merchant must be a string of at most ${TEXT_LIMITS.merchant} characters or null` });
      return;
    }
    updates.merchant = merchant;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "notes")) {
    const notes = parseOptionalText(body.notes, TEXT_LIMITS.notes);
    if (notes === undefined) {
      res.status(400).json({ error: `notes must be a string of at most ${TEXT_LIMITS.notes} characters or null` });
      return;
    }
    updates.notes = notes;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "bookedOn")) {
    if (!isDateOnly(body.bookedOn)) {
      res.status(400).json({ error: "bookedOn must use YYYY-MM-DD format" });
      return;
    }
    updates.bookedOn = body.bookedOn;
    hasUpdates = true;
  }

  if (Object.hasOwn(body, "occurredAt")) {
    if (body.occurredAt !== null && !isIsoTimestamp(body.occurredAt)) {
      res.status(400).json({ error: "occurredAt must be a valid ISO 8601 timestamp or null" });
      return;
    }
    updates.occurredAt = body.occurredAt === null ? null : new Date(body.occurredAt);
    hasUpdates = true;
  }

  if (!hasUpdates) {
    res.status(400).json({ error: "Provide at least one editable transaction field" });
    return;
  }

  const candidateType = updates.type ?? transaction.type;
  const amountError = signError(candidateType, updates.amountMinor ?? transaction.amountMinor);
  if (amountError) {
    res.status(400).json({ error: amountError });
    return;
  }

  // An unrelated edit must not be blocked by a category that no longer allows the type.
  if (Object.hasOwn(updates, "type") || Object.hasOwn(updates, "categoryId")) {
    const candidateCategoryId = Object.hasOwn(updates, "categoryId")
      ? (updates.categoryId ?? null)
      : transaction.categoryId;
    const categoryError = await validateCategory(candidateCategoryId, candidateType, res.locals.userId);
    if (categoryError) {
      res.status(categoryError.status).json({ error: categoryError.error });
      return;
    }
  }

  const updatedTransaction = await updateTransaction(transaction.id, updates);
  res.json(updatedTransaction);
});

/** Permanently deletes a transaction owned by the authenticated user. Deleting one leg of a transfer deletes both. */
transactionsRouter.delete("/:transactionId", async (req, res) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  const ownedTransaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
  if (!ownedTransaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  const { transaction } = ownedTransaction;

  await deleteTransaction(transaction);
  res.status(204).send();
});

/**
 * Creates two linked transfer transactions: money leaves one owned account and arrives in another.
 * Amounts are positive; the source leg is stored negative. Transfer legs have no category.
 */
transactionsRouter.post("/transfers", async (req, res) => {
  const { fromAccountId, toAccountId, fromAmountMinor, toAmountMinor, description, notes, bookedOn, occurredAt } =
    req.body ?? {};

  if (!isUuid(fromAccountId)) {
    res.status(400).json({ error: "fromAccountId must be a valid UUID" });
    return;
  }
  if (!isUuid(toAccountId)) {
    res.status(400).json({ error: "toAccountId must be a valid UUID" });
    return;
  }
  if (fromAccountId === toAccountId) {
    res.status(400).json({ error: "fromAccountId and toAccountId must be different" });
    return;
  }
  if (!Number.isSafeInteger(fromAmountMinor) || fromAmountMinor <= 0) {
    res.status(400).json({ error: "fromAmountMinor must be a positive safe integer" });
    return;
  }
  if (!Number.isSafeInteger(toAmountMinor) || toAmountMinor <= 0) {
    res.status(400).json({ error: "toAmountMinor must be a positive safe integer" });
    return;
  }
  const fields = parseEntryFields({ description, bookedOn, notes, occurredAt });
  if ("error" in fields) {
    res.status(400).json({ error: fields.error });
    return;
  }

  const [fromAccount, toAccount] = await Promise.all([
    findOwnedAccount(fromAccountId, res.locals.userId),
    findOwnedAccount(toAccountId, res.locals.userId),
  ]);
  if (!fromAccount || !toAccount) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (fromAccount.isArchived || toAccount.isArchived) {
    res.status(409).json({ error: "Account is archived. Restore it before making changes." });
    return;
  }
  // Without an exchange rate, a transfer inside one currency must move the same amount out and in.
  if (fromAccount.currencyCode === toAccount.currencyCode && fromAmountMinor !== toAmountMinor) {
    res.status(400).json({ error: "Amounts must be equal when both accounts use the same currency" });
    return;
  }

  const sharedFields = {
    createdById: res.locals.userId,
    type: "transfer",
    transferGroupId: randomUUID(),
    description: fields.description,
    notes: fields.notes,
    bookedOn,
    ...(occurredAt === undefined ? {} : { occurredAt: occurredAt === null ? null : new Date(occurredAt) }),
  };
  const [from, to] = await insertTransferLegs([
    { ...sharedFields, accountId: fromAccount.id, amountMinor: -fromAmountMinor },
    { ...sharedFields, accountId: toAccount.id, amountMinor: toAmountMinor },
  ]);

  res.status(201).json({ from, to });
});

/**
 * Creates an expense or income transaction in an account owned by the authenticated user.
 * Transfers are created with POST /transfers.
 */
transactionsRouter.post("/", async (req, res) => {
  const { accountId, type, categoryId, amountMinor, description, merchant, notes, bookedOn, occurredAt } =
    req.body ?? {};

  if (!isUuid(accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  if (!isTransactionType(type)) {
    res.status(400).json({ error: "type must be expense, income, or transfer" });
    return;
  }

  if (type === "transfer") {
    res.status(400).json({ error: "Transfers are created with POST /transactions/transfers" });
    return;
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    res.status(400).json({ error: "amountMinor must be a non-zero safe integer" });
    return;
  }

  const amountError = signError(type, amountMinor);
  if (amountError) {
    res.status(400).json({ error: amountError });
    return;
  }

  const fields = parseEntryFields({ description, bookedOn, notes, occurredAt });
  if ("error" in fields) {
    res.status(400).json({ error: fields.error });
    return;
  }

  if (categoryId !== undefined && !isUuid(categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  const merchantText = parseOptionalText(merchant ?? null, TEXT_LIMITS.merchant);
  if (merchantText === undefined) {
    res.status(400).json({ error: `merchant must be a string of at most ${TEXT_LIMITS.merchant} characters or null` });
    return;
  }

  const account = await findOwnedAccount(accountId, res.locals.userId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (account.isArchived) {
    res.status(409).json({ error: "Account is archived. Restore it before making changes." });
    return;
  }

  const categoryError = await validateCategory(categoryId ?? null, type, res.locals.userId);
  if (categoryError) {
    res.status(categoryError.status).json({ error: categoryError.error });
    return;
  }

  const transaction = await insertTransaction({
    accountId: account.id,
    createdById: res.locals.userId,
    type,
    ...(categoryId === undefined ? {} : { categoryId }),
    amountMinor,
    description: fields.description,
    merchant: merchantText,
    notes: fields.notes,
    bookedOn,
    ...(occurredAt === undefined ? {} : { occurredAt: occurredAt === null ? null : new Date(occurredAt) }),
  });

  res.status(201).json(transaction);
});
