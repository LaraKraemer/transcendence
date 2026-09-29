import { Router } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { findOwnedAccount } from "../db/accounts.ts";
import {
  findCategoryKind,
  findOwnedTransaction,
  insertTransaction,
  listTransactionsByAccount,
  summarizeTransactionsByCategory,
  updateTransaction,
  voidTransaction,
} from "../db/transactions.ts";
import { isDateOnly, isIsoTimestamp, isUuid } from "../validation.ts";

const TRANSACTION_STATUSES = ["pending", "cleared", "void"] as const;
type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

function isTransactionStatus(value: unknown): value is TransactionStatus {
  return typeof value === "string" && TRANSACTION_STATUSES.includes(value as TransactionStatus);
}

function parsePaginationInt(value: unknown, defaultValue: number): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Ensures a selected category belongs to the user and matches the amount sign. */
async function validateCategory(
  categoryId: string | null,
  amountMinor: number,
  userId: string,
  allowArchived = false,
): Promise<string | undefined> {
  if (categoryId === null) return undefined;

  const category = await findCategoryKind(categoryId, userId, allowArchived);

  if (!category) return "Category not found";
  if (category.kind === "transfer") return undefined;

  const requiredKind = amountMinor < 0 ? "expense" : "income";
  return category.kind === requiredKind
    ? undefined
    : `A ${requiredKind} transaction requires an ${requiredKind} category`;
}

export const transactionsRouter = Router();

transactionsRouter.use(requireAuthenticatedUser);

/**
 * Lists transactions for one account owned by the authenticated user.
 *
 * Required query parameter: accountId
 * Optional query parameters: limit (default 50), offset (default 0), from, to
 */
transactionsRouter.get("/", async (req, res, next) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (!accountId) {
    res.status(400).json({ error: "accountId is required" });
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

  try {
    const account = await findOwnedAccount(accountId, res.locals.userId);

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const result = await listTransactionsByAccount(account.id, {
      limit,
      offset,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Returns non-void transaction totals by category, including uncategorized transactions. */
transactionsRouter.get("/summary", async (req, res, next) => {
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

  try {
    const account = await findOwnedAccount(accountId, res.locals.userId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const rows = await summarizeTransactionsByCategory(
      account.id,
      from as string | undefined,
      to as string | undefined,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

/** Returns one transaction from an account owned by the authenticated user. */
transactionsRouter.get("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

/** Updates a transaction while preserving account ownership and category rules. */
transactionsRouter.patch("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  const body = req.body ?? {};

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const updates: {
      categoryId?: string | null;
      amountMinor?: number;
      description?: string;
      notes?: string | null;
      bookedOn?: string;
      status?: TransactionStatus;
      occurredAt?: Date | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    let hasUpdates = false;

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
      if (
        typeof body.description !== "string" ||
        body.description.trim().length === 0 ||
        body.description.trim().length > 500
      ) {
        res.status(400).json({ error: "description must be between 1 and 500 characters" });
        return;
      }
      updates.description = body.description.trim();
      hasUpdates = true;
    }

    if (Object.hasOwn(body, "notes")) {
      if (body.notes !== null && typeof body.notes !== "string") {
        res.status(400).json({ error: "notes must be a string or null" });
        return;
      }
      updates.notes = body.notes === null ? null : body.notes.trim();
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

    if (Object.hasOwn(body, "status")) {
      if (!isTransactionStatus(body.status)) {
        res.status(400).json({ error: "status must be pending, cleared, or void" });
        return;
      }
      updates.status = body.status;
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

    const candidateAmount = updates.amountMinor ?? transaction.amountMinor;
    const candidateCategoryId = Object.hasOwn(updates, "categoryId")
      ? (updates.categoryId ?? null)
      : transaction.categoryId;
    const categoryError = await validateCategory(
      candidateCategoryId,
      candidateAmount,
      res.locals.userId,
      !Object.hasOwn(body, "categoryId"),
    );
    if (categoryError) {
      res.status(categoryError === "Category not found" ? 404 : 400).json({ error: categoryError });
      return;
    }

    const updatedTransaction = await updateTransaction(transaction.id, updates);
    res.json(updatedTransaction);
  } catch (error) {
    next(error);
  }
});

/** Voids a transaction instead of deleting financial history permanently. */
transactionsRouter.delete("/:transactionId", async (req, res, next) => {
  if (!isUuid(req.params.transactionId)) {
    res.status(400).json({ error: "transactionId must be a valid UUID" });
    return;
  }

  try {
    const transaction = await findOwnedTransaction(req.params.transactionId, res.locals.userId);
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    await voidTransaction(transaction.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Creates an expense, income, or transfer transaction in an account owned by the
 * authenticated user.
 */
transactionsRouter.post("/", async (req, res, next) => {
  const { accountId, categoryId, amountMinor, description, notes, bookedOn, status, occurredAt } = req.body ?? {};

  if (!isUuid(accountId)) {
    res.status(400).json({ error: "accountId must be a valid UUID" });
    return;
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    res.status(400).json({ error: "amountMinor must be a non-zero safe integer" });
    return;
  }

  if (typeof description !== "string" || description.trim().length === 0 || description.trim().length > 500) {
    res.status(400).json({ error: "description must be between 1 and 500 characters" });
    return;
  }

  if (!isDateOnly(bookedOn)) {
    res.status(400).json({ error: "bookedOn must use YYYY-MM-DD format" });
    return;
  }

  if (status !== undefined && !isTransactionStatus(status)) {
    res.status(400).json({ error: "status must be pending, cleared, or void" });
    return;
  }

  if (notes !== undefined && typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }

  if (categoryId !== undefined && !isUuid(categoryId)) {
    res.status(400).json({ error: "categoryId must be a valid UUID" });
    return;
  }

  if (occurredAt !== undefined && occurredAt !== null && !isIsoTimestamp(occurredAt)) {
    res.status(400).json({ error: "occurredAt must be a valid ISO 8601 timestamp or null" });
    return;
  }

  try {
    const account = await findOwnedAccount(accountId, res.locals.userId, false);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const categoryError = await validateCategory(categoryId ?? null, amountMinor, res.locals.userId);
    if (categoryError) {
      res.status(categoryError === "Category not found" ? 404 : 400).json({ error: categoryError });
      return;
    }

    const transaction = await insertTransaction({
      accountId: account.id,
      createdById: res.locals.userId,
      ...(categoryId === undefined ? {} : { categoryId }),
      amountMinor,
      description: description.trim(),
      ...(notes === undefined ? {} : { notes: notes.trim() }),
      bookedOn,
      ...(status === undefined ? {} : { status }),
      ...(occurredAt === undefined ? {} : { occurredAt: occurredAt === null ? null : new Date(occurredAt) }),
    });

    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
});
